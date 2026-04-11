# -*- coding: utf-8 -*-
"""Bilibili API 封装。"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import json
import re
import sys
import time

import requests

import config
import wbi


@dataclass
class CommentProgress:
    top_level_fetched: int
    top_level_target: int | None
    total_fetched: int
    total_target: int


CommentProgressCallback = Callable[[CommentProgress], None]
SUB_REPLY_WORKERS = 4
REQUEST_RETRIES = 3

_SESSION = requests.Session()
_SESSION.headers.update(config.BASE_HEADERS)


def refresh_session_headers() -> None:
    _SESSION.headers.clear()
    _SESSION.headers.update(config.BASE_HEADERS)


def _validate_login_value(cookie_header: str, empty_message: str) -> tuple[bool, str]:
    if not cookie_header:
        return True, empty_message

    headers = dict(config.BASE_HEADERS)
    headers["Cookie"] = cookie_header
    last_error: Exception | None = None

    for attempt in range(REQUEST_RETRIES):
        try:
            response = requests.get(config.API_NAV, headers=headers, timeout=15)
            payload = response.json()
            if payload.get("code") != 0:
                message = payload.get("message", "未知错误")
                return False, f"B站返回错误：{message}"

            data = payload.get("data", {})
            if data.get("isLogin"):
                user_name = data.get("uname", "")
                if user_name:
                    return True, f"登录信息有效，当前账号：{user_name}"
                return True, "登录信息有效"
            return False, "登录信息无效，或当前登录状态已失效。"
        except Exception as exc:
            last_error = exc
            if attempt < REQUEST_RETRIES - 1:
                time.sleep(0.25 * (attempt + 1))
                continue

    return False, f"登录信息检测失败：{last_error}"


def validate_sessdata(sessdata: str) -> tuple[bool, str]:
    sessdata = (sessdata or "").strip()
    cookie_header = config.build_cookie_header("sessdata", sessdata=sessdata, cookie="")
    return _validate_login_value(cookie_header, "未填写 SESSDATA，将按未登录方式运行。")


def validate_cookie(cookie: str) -> tuple[bool, str]:
    cookie = (cookie or "").strip()
    return _validate_login_value(cookie, "未填写整串 Cookie，将按未登录方式运行。")


def _log(message: str) -> None:
    try:
        print(message)
    except UnicodeEncodeError:
        if hasattr(sys.stdout, "buffer"):
            sys.stdout.buffer.write((message + "`n").encode("gbk", errors="replace"))
        else:
            print(message.encode("ascii", errors="replace").decode("ascii"))


def _request_json(
    url: str,
    api_name: str,
    *,
    params: dict | None = None,
    use_session: bool = True,
    timeout: int = 15,
) -> dict:
    client = _SESSION if use_session else requests
    last_error: Exception | None = None
    for attempt in range(REQUEST_RETRIES):
        try:
            resp = client.get(url, params=params, headers=config.BASE_HEADERS, timeout=timeout)
            try:
                return resp.json()
            except ValueError as exc:
                snippet = resp.text[:160].strip().replace("`n", " ")
                raise RuntimeError(
                    f"{api_name} 返回了非 JSON 内容，状态码 {resp.status_code}，内容片段：{snippet or '<empty>'}"
                ) from exc
        except Exception as exc:
            last_error = exc
            if attempt < REQUEST_RETRIES - 1:
                time.sleep(0.25 * (attempt + 1))
                continue
            raise RuntimeError(f"{api_name} 请求失败：{exc}") from exc
    raise RuntimeError(f"{api_name} 请求失败：{last_error}")


def extract_bvid(input_str: str) -> str:
    match = re.search(r"(BV[a-zA-Z0-9]+)", input_str.strip())
    if match:
        return match.group(1)
    raise ValueError(f"无法从输入中提取 BV 号：{input_str}")


def get_video_info(bvid: str) -> dict:
    _log(f"正在获取视频信息：{bvid}")
    data = _request_json(
        config.API_VIDEO_INFO,
        "视频信息接口",
        params={"bvid": bvid},
    )
    if data.get("code") != 0:
        raise RuntimeError(f"获取视频信息失败：{data.get('message', '未知错误')}")

    video = data["data"]
    return {
        "bvid": video["bvid"],
        "aid": video["aid"],
        "cid": video["cid"],
        "tid": video.get("tid", 0),
        "tname": video.get("tname", ""),
        "title": video["title"],
        "desc": video.get("desc", ""),
        "owner": {
            "mid": video["owner"]["mid"],
            "name": video["owner"]["name"],
        },
        "stat": {
            "view": video["stat"]["view"],
            "like": video["stat"]["like"],
            "coin": video["stat"]["coin"],
            "favorite": video["stat"]["favorite"],
            "share": video["stat"]["share"],
            "danmaku": video["stat"]["danmaku"],
            "reply": video["stat"]["reply"],
        },
        "pages": [
            {"cid": page["cid"], "part": page["part"], "page": page["page"]}
            for page in video.get("pages", [])
        ],
        "pubdate": video.get("pubdate", 0),
        "duration": video.get("duration", 0),
    }


def get_comment_count(oid: int) -> int:
    data = _request_json(
        config.API_COMMENTS_COUNT,
        "评论计数接口",
        params={"oid": oid, "type": 1},
    )
    if data.get("code") != 0:
        raise RuntimeError(f"获取评论总数失败：{data.get('message', '未知错误')}")
    return int(data.get("data", {}).get("count", 0))


def _format_comment(comment: dict) -> dict:
    member = comment.get("member", {})
    level_info = member.get("level_info", {})
    return {
        "rpid": comment["rpid"],
        "user": {
            "mid": member.get("mid", ""),
            "name": member.get("uname", ""),
            "avatar": member.get("avatar", ""),
            "level": level_info.get("current_level", 0),
        },
        "content": comment.get("content", {}).get("message", ""),
        "like": comment.get("like", 0),
        "ctime": comment.get("ctime", 0),
        "ctime_text": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(comment.get("ctime", 0))),
        "replies": [],
    }


def _normalize_lang_tag(value: str) -> str:
    return (value or "").strip().lower().replace("_", "-")


def _is_chinese_subtitle(subtitle: dict) -> bool:
    lang = _normalize_lang_tag(subtitle.get("lan", ""))
    name = subtitle.get("lang", "")
    return lang.startswith("zh") or "中文" in name or "汉语" in name or "汉字" in name


def _is_english_subtitle(subtitle: dict) -> bool:
    lang = _normalize_lang_tag(subtitle.get("lan", ""))
    name = subtitle.get("lang", "")
    return lang.startswith("en") or "english" in name.lower() or "英文" in name


def _select_preferred_subtitles(subtitles: list[dict]) -> list[dict]:
    chinese = [item for item in subtitles if _is_chinese_subtitle(item)]
    english = [item for item in subtitles if _is_english_subtitle(item)]

    selected: list[dict] = []
    if chinese:
        selected.append(chinese[0])
    if english:
        english_item = english[0]
        if all(english_item.get("lan") != item.get("lan") for item in selected):
            selected.append(english_item)
    if selected:
        return selected

    return subtitles[:1]


def _build_page_descriptor(page: dict) -> dict:
    page_no = int(page.get("page") or 1)
    page_part = str(page.get("part") or "").strip() or f"P{page_no}"
    return {
        "page": page_no,
        "part": page_part,
        "label": f"P{page_no}：{page_part}",
    }


def _fetch_subtitles_for_cid(aid: int, cid: int) -> list[dict]:
    player_data: dict | None = None
    player_errors: list[str] = []
    for api_name, api_url in [
        ("字幕信息接口", config.API_PLAYER_WBI),
        ("播放器字幕接口", config.API_PLAYER),
    ]:
        try:
            data = _request_json(
                api_url,
                api_name,
                params={"aid": aid, "cid": cid},
            )
            if data.get("code") == 0:
                player_data = data.get("data", {})
                break
            player_errors.append(f"{api_name}: {data.get('message', '未知错误')}")
        except Exception as exc:
            player_errors.append(f"{api_name}: {exc}")

    if player_data is None:
        if player_errors:
            _log(f"字幕接口请求失败，已跳过字幕：{player_errors[-1]}")
        else:
            _log("字幕接口请求失败，已跳过字幕")
        return []

    subtitle_info = player_data.get("subtitle") or {}
    subtitle_list = subtitle_info.get("subtitles") or []
    if not subtitle_list:
        if player_data.get("need_login_subtitle"):
            _log("该视频字幕需要登录后才能访问，请在客户端设置中填写 B站登录信息。")
        else:
            _log("该视频没有可抓取字幕")
        return []

    all_subtitles: list[dict] = []
    for sub_meta in subtitle_list:
        lang = sub_meta.get("lan_doc", sub_meta.get("lan", "未知"))
        url = sub_meta.get("subtitle_url", "")
        if not url:
            continue
        if url.startswith("//"):
            url = "https:" + url

        _log(f"下载字幕：{lang}")
        try:
            sub_data = _request_json(url, f"字幕下载接口({lang})", use_session=False)
        except Exception as exc:
            _log(f"下载字幕失败，已跳过 {lang}：{exc}")
            continue

        entries = [
            {
                "from": item.get("from", 0),
                "to": item.get("to", 0),
                "content": item.get("content", ""),
            }
            for item in sub_data.get("body", [])
        ]
        all_subtitles.append(
            {
                "lang": lang,
                "lan": sub_meta.get("lan", ""),
                "entries": entries,
            }
        )

    if not all_subtitles:
        _log("字幕接口可访问，但没有成功保存任何字幕，已跳过字幕")
        return []

    return _select_preferred_subtitles(all_subtitles)


def _get_sub_replies(oid: int, root_rpid: int) -> list[dict]:
    all_replies: list[dict] = []
    seen: set[int] = set()

    page_num = 1
    expected_total: int | None = None
    while True:
        data = _request_json(
            config.API_COMMENTS_REPLY,
            "子评论列表接口",
            params={
                "oid": oid,
                "type": 1,
                "root": root_rpid,
                "ps": config.REPLY_PAGE_SIZE,
                "pn": page_num,
            },
        )
        if data.get("code") != 0:
            _log(f"获取子评论失败（rpid={root_rpid}）：{data.get('message', '未知错误')}")
            return all_replies

        payload = data.get("data") or {}
        replies = payload.get("replies") or []
        page = payload.get("page") or {}
        if expected_total is None:
            try:
                expected_total = int(page.get("count") or 0)
            except Exception:
                expected_total = 0

        if not replies:
            break

        page_added = 0
        for reply in replies:
            reply_rpid = int(reply.get("rpid") or 0)
            if reply_rpid and reply_rpid in seen:
                continue
            if reply_rpid:
                seen.add(reply_rpid)
            all_replies.append(_format_comment(reply))
            page_added += 1

        if page_added <= 0:
            break
        if expected_total and len(all_replies) >= expected_total:
            break
        if len(replies) < config.REPLY_PAGE_SIZE:
            break
        page_num += 1

    return all_replies


def _should_fetch_sub_replies(raw_comment: dict) -> bool:
    inline_replies = raw_comment.get("replies") or []
    inline_count = len(inline_replies)
    reply_count = int(raw_comment.get("rcount") or 0)
    if reply_count > inline_count:
        return True
    if reply_count > 0 and inline_count <= 0:
        return True
    return False


def _fill_sub_replies_parallel(oid: int, page_comments: list[tuple[dict, dict]]) -> None:
    pending: list[tuple[int, dict, str]] = []
    for raw_comment, formatted in page_comments:
        inline_replies = raw_comment.get("replies") or []
        formatted["replies"] = [_format_comment(reply) for reply in inline_replies]
        if _should_fetch_sub_replies(raw_comment):
            pending.append((raw_comment["rpid"], formatted, formatted["user"]["name"]))

    if not pending:
        return

    with ThreadPoolExecutor(max_workers=SUB_REPLY_WORKERS) as executor:
        future_map = {
            executor.submit(_get_sub_replies, oid, rpid): (formatted, user_name)
            for rpid, formatted, user_name in pending
        }
        for future in as_completed(future_map):
            formatted, user_name = future_map[future]
            try:
                fetched_replies = future.result()
                if fetched_replies:
                    existing = formatted.get("replies", [])
                    seen = {item.get("rpid") for item in existing}
                    merged = existing + [item for item in fetched_replies if item.get("rpid") not in seen]
                    formatted["replies"] = merged
                    _log(f"补抓子评论 {len(fetched_replies)} 条：{user_name}")
            except Exception as exc:
                _log(f"补抓子评论失败：{user_name} ({exc})")


def get_all_comments(
    oid: int,
    max_comments: int = 0,
    total_comments: int = 0,
    progress_callback: CommentProgressCallback | None = None,
    enable_sub_reply_fetch: bool = True,
) -> list[dict]:
    all_comments: list[dict] = []
    total_fetched = 0
    offset = ""
    top_level_target: int | None = max_comments if max_comments else None

    _log("正在获取评论区...")

    while True:
        pagination = json.dumps({"offset": offset}, separators=(",", ":"), ensure_ascii=False)
        data = _request_json(
            config.API_COMMENTS_MAIN,
            "评论主列表接口",
            params=wbi.sign_params(
                {
                    "oid": oid,
                    "type": 1,
                    "mode": 2,
                    "pagination_str": pagination,
                }
            ),
        )
        if data.get("code") != 0:
            raise RuntimeError(f"获取评论失败：{data.get('message', '未知错误')}")

        payload = data.get("data", {})
        cursor = payload.get("cursor", {})
        replies = payload.get("replies") or []
        if not replies:
            break

        page_comments = [(comment, _format_comment(comment)) for comment in replies]
        if enable_sub_reply_fetch:
            _fill_sub_replies_parallel(oid, page_comments)
        else:
            for raw_comment, formatted in page_comments:
                inline_replies = raw_comment.get("replies") or []
                formatted["replies"] = [_format_comment(reply) for reply in inline_replies]

        for _, formatted in page_comments:
            all_comments.append(formatted)
            total_fetched += 1 + len(formatted.get("replies", []))
            if progress_callback:
                total_target = max(total_comments, total_fetched)
                progress_callback(
                    CommentProgress(
                        top_level_fetched=len(all_comments),
                        top_level_target=(max(top_level_target, len(all_comments)) if top_level_target is not None else None),
                        total_fetched=total_fetched,
                        total_target=total_target,
                    )
                )
            if max_comments and len(all_comments) >= max_comments:
                _log(f"已达到评论上限：{max_comments}")
                return all_comments[:max_comments]

        if cursor.get("is_end"):
            break

        next_offset = (cursor.get("pagination_reply") or {}).get("next_offset", "")
        if not next_offset or next_offset == offset:
            break
        offset = next_offset
        _log(f"已获取 {len(all_comments)} 条一级评论，继续下一页...")

    _log(f"评论获取完毕，共 {len(all_comments)} 条一级评论")
    return all_comments


def get_subtitles(aid: int, cid: int) -> list[dict]:
    _log("正在获取字幕...")
    selected_subtitles = _fetch_subtitles_for_cid(aid, cid)
    if not selected_subtitles:
        return []

    total_entries = sum(len(item["entries"]) for item in selected_subtitles)
    selected_label = ", ".join(item["lang"] for item in selected_subtitles)
    _log(f"字幕获取完毕，已保留：{selected_label}，共 {total_entries} 条")
    return selected_subtitles


def get_subtitles_bundle(video_info: dict) -> dict:
    aid = int(video_info["aid"])
    default_cid = int(video_info["cid"])
    pages = video_info.get("pages") or [{"cid": default_cid, "part": video_info.get("title", ""), "page": 1}]

    combined_tracks: dict[str, dict] = {}
    pages_with_subtitles = 0
    pages_without_subtitles: list[dict] = []

    _log(f"正在获取字幕（默认合并全部分P，共 {len(pages)} 个）...")
    for page in pages:
        cid = int(page.get("cid") or 0)
        if not cid:
            continue

        page_info = _build_page_descriptor(page)
        page_no = page_info["page"]
        page_part = page_info["part"]
        page_label = page_info["label"]
        _log(f"正在获取 {page_label} 的字幕...")
        page_subtitles = _fetch_subtitles_for_cid(aid, cid)
        if not page_subtitles:
            pages_without_subtitles.append(page_info)
            continue

        pages_with_subtitles += 1
        for subtitle in page_subtitles:
            track_key = subtitle.get("lan") or subtitle.get("lang") or "unknown"
            track = combined_tracks.setdefault(
                track_key,
                {
                    "lang": subtitle.get("lang", "未知"),
                    "lan": subtitle.get("lan", ""),
                    "entries": [],
                    "page_segments": [],
                },
            )
            entries = subtitle.get("entries") or []
            track["entries"].extend(entries)
            track["page_segments"].append(
                {
                    "label": page_label,
                    "entries": entries,
                }
            )

    subtitles = list(combined_tracks.values())
    if subtitles:
        total_entries = sum(len(item.get("entries") or []) for item in subtitles)
        selected_label = ", ".join(item.get("lang", "未知") for item in subtitles)
        note = (
            f"默认合并全部分P；成功获取 {pages_with_subtitles}/{len(pages)} 个分P 的字幕，"
            f"共 {total_entries} 条，已保留语言：{selected_label}。"
        )
        _log(f"字幕获取完毕，{note}")
        return {
            "subtitles": subtitles,
            "source_type": "已合并全部分P字幕",
            "source_api": "get_subtitles_bundle",
            "note": note,
            "page_count": len(pages),
            "pages_with_subtitles": pages_with_subtitles,
            "pages_without_subtitles": pages_without_subtitles,
        }

    note = f"已尝试合并全部分P，但 {len(pages)} 个分P 都未获取到可用字幕。"
    _log(note)
    return {
        "subtitles": [],
        "source_type": "未获取到字幕",
        "source_api": "get_subtitles_bundle",
        "note": note,
        "page_count": len(pages),
        "pages_with_subtitles": 0,
        "pages_without_subtitles": pages_without_subtitles or [_build_page_descriptor(page) for page in pages],
    }
