# -*- coding: utf-8 -*-
"""无字幕时的音频下载与转写兜底。"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
from typing import Any, Callable

import imageio_ffmpeg
import requests
from yt_dlp import YoutubeDL

import config
import local_audio_client


FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
TARGET_AUDIO_MAX_BYTES = 24 * 1024 * 1024
TARGET_SAMPLE_RATE = 16000
TARGET_CHANNELS = 1
TARGET_BITRATE = "32k"


def _env(name: str, legacy_name: str, default: str) -> str:
    return os.getenv(name, "").strip() or os.getenv(legacy_name, "").strip() or default


LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS = max(
    90.0,
    float(_env("SHIJIE_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS", "ONBOARD_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS", "240") or "240"),
)
AUDIO_MAX_CHUNK_SECONDS = max(
    120.0,
    float(_env("SHIJIE_AUDIO_MAX_CHUNK_SECONDS", "ONBOARD_AUDIO_MAX_CHUNK_SECONDS", "480") or "480"),
)
AUDIO_PREPARE_WORKERS = max(
    1,
    int(_env("SHIJIE_AUDIO_PREPARE_WORKERS", "ONBOARD_AUDIO_PREPARE_WORKERS", "2") or "2"),
)
AUDIO_TRANSCRIBE_WORKERS = max(
    1,
    int(_env("SHIJIE_AUDIO_TRANSCRIBE_WORKERS", "ONBOARD_AUDIO_TRANSCRIBE_WORKERS", "3") or "3"),
)
AUDIO_CHUNK_WORKERS = max(
    1,
    int(_env("SHIJIE_AUDIO_CHUNK_WORKERS", "ONBOARD_AUDIO_CHUNK_WORKERS", "3") or "3"),
)
LOCAL_AUDIO_TRANSCRIBE_WORKERS = max(
    1,
    int(_env("SHIJIE_LOCAL_AUDIO_TRANSCRIBE_WORKERS", "ONBOARD_LOCAL_AUDIO_TRANSCRIBE_WORKERS", "1") or "1"),
)
AUDIO_PREPARE_CACHE_VERSION = "audio-prepare.v2"
TRANSCRIPT_CHUNK_CACHE_VERSION = "audio-transcript-chunk.v2"
PAGE_TRANSCRIPT_CACHE_VERSION = "audio-transcript-page.v2"
TRANSCRIPT_SEGMENT_TARGET_CHARS = max(
    40,
    int(_env("SHIJIE_TRANSCRIPT_SEGMENT_TARGET_CHARS", "ONBOARD_TRANSCRIPT_SEGMENT_TARGET_CHARS", "90") or "90"),
)
TRANSCRIPT_SEGMENT_MAX_CHARS = max(
    TRANSCRIPT_SEGMENT_TARGET_CHARS,
    int(_env("SHIJIE_TRANSCRIPT_SEGMENT_MAX_CHARS", "ONBOARD_TRANSCRIPT_SEGMENT_MAX_CHARS", "120") or "120"),
)

ProgressCallback = Callable[[str, int], None]
PageResultCallback = Callable[[dict[str, Any]], None]


@dataclass
class TranscriptionBundle:
    subtitles: list[dict]
    pages_transcribed: int
    pages_without_text: list[str]
    entry_count: int
    source_type: str
    source_api: str
    note: str
    model: str


@dataclass
class PreparedPageAudio:
    page_no: int
    page_label: str
    chunks: list[dict[str, Any]]


@dataclass
class TranscribedPageResult:
    page_no: int
    page_label: str
    entries: list[dict[str, Any]]


def _emit(progress_callback: ProgressCallback | None, message: str, percent: int) -> None:
    if progress_callback:
        progress_callback(message, percent)
    else:
        print(message)


def _sanitize_stem(value: str) -> str:
    value = re.sub(r'[\\/:*?"<>|]', "_", value or "").strip(" .")
    return value or "audio"


class _SilentYtdlpLogger:
    def debug(self, _message: str) -> None:
        return

    def warning(self, _message: str) -> None:
        return

    def error(self, _message: str) -> None:
        return


def _run_ffmpeg(args: list[str], description: str) -> None:
    command = [FFMPEG_EXE, *args]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        hint = detail[-1] if detail else "未知 ffmpeg 错误"
        raise RuntimeError(f"{description}失败：{hint}")


def _audio_profile(provider_api: str) -> dict[str, Any]:
    return {
        "extension": "wav",
        "encode_args": ["-c:a", "pcm_s16le"],
    }


def _max_chunk_seconds(provider_api: str) -> float:
    if provider_api == "local_sensevoice":
        return LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS
    return AUDIO_MAX_CHUNK_SECONDS


def _probe_duration_seconds(file_path: str) -> float:
    result = subprocess.run(
        [FFMPEG_EXE, "-i", file_path],
        capture_output=True,
        text=True,
    )
    text = f"{result.stdout}\n{result.stderr}"
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not match:
        raise RuntimeError("无法识别音频时长。")
    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = float(match.group(3))
    return hours * 3600 + minutes * 60 + seconds


def _guess_language(video_info: dict) -> str | None:
    sample = f"{video_info.get('title', '')}\n{video_info.get('desc', '')}"
    chinese_count = len(re.findall(r"[\u4e00-\u9fff]", sample))
    alpha_count = len(re.findall(r"[A-Za-z]", sample))
    if chinese_count >= max(8, alpha_count):
        return "zh"
    return None


def _build_transcription_prompt(video_info: dict, page_label: str) -> str:
    return (
        "请按原意转写语音内容，保留中文标点、专有名词、命令、参数、产品名和中英文混合词。"
        f"当前视频标题：{video_info.get('title', '')}。"
        f"当前分段：{page_label}。"
    )


def _build_page_url(video_info: dict, page_no: int) -> str:
    bvid = video_info["bvid"]
    if int(page_no or 1) <= 1:
        return f"https://www.bilibili.com/video/{bvid}"
    return f"https://www.bilibili.com/video/{bvid}?p={page_no}"


def _normalize_provider() -> str:
    return "local_sensevoice"


def _resolve_transcription_backend() -> tuple[str, str, str]:
    provider = _normalize_provider()
    if not local_audio_client.has_local_engine():
        root_display = local_audio_client.get_root_display() or "未填写"
        raise RuntimeError(f"未找到可用的本地 SenseVoice 环境，请检查目录：{root_display}")
    return "本地 SenseVoice", "local_sensevoice", local_audio_client.get_model()


def _transcribe_chunk(
    provider_api: str,
    file_path: str,
    *,
    prompt: str,
    language: str | None,
) -> dict:
    return local_audio_client.transcribe_audio_file(
        file_path,
        prompt=prompt,
        language=language,
    )


def _write_cookie_file(cookie_path: str) -> str | None:
    sessdata = (config.SESSDATA or "").strip()
    if not sessdata:
        return None

    content = (
        "# Netscape HTTP Cookie File\n"
        ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\t"
        f"{sessdata}\n"
    )
    with open(cookie_path, "w", encoding="utf-8") as file:
        file.write(content)
    return cookie_path


def _download_audio(page_url: str, work_dir: str, file_stem: str) -> str:
    outtmpl = os.path.join(work_dir, f"{file_stem}.%(ext)s")
    headers = {
        "User-Agent": config.BASE_HEADERS.get("User-Agent", ""),
        "Referer": config.BASE_HEADERS.get("Referer", "https://www.bilibili.com"),
    }
    cookie_file = _write_cookie_file(os.path.join(work_dir, "cookies.txt"))

    options = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "overwrites": True,
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": outtmpl,
        "http_headers": headers,
        "logger": _SilentYtdlpLogger(),
        "socket_timeout": 60,
        "retries": 4,
        "fragment_retries": 4,
        "extractor_retries": 2,
    }
    if cookie_file:
        options["cookiefile"] = cookie_file
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(page_url, download=True)
        requested = info.get("requested_downloads") or []
        for item in requested:
            filepath = item.get("filepath")
            if filepath and os.path.exists(filepath):
                return filepath

        downloaded = ydl.prepare_filename(info)
        if os.path.exists(downloaded):
            return downloaded

    raise RuntimeError("音频下载完成后未找到输出文件。")


def _find_page_cid(video_info: dict, page_no: int, page: dict | None = None) -> int:
    if page and page.get("cid"):
        return int(page["cid"])
    for item in video_info.get("pages") or []:
        if int(item.get("page") or 0) == int(page_no):
            return int(item.get("cid") or 0)
    if int(page_no or 1) == 1:
        return int(video_info.get("cid") or 0)
    return 0


def _select_playurl_audio(audio_items: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [item for item in audio_items if isinstance(item, dict) and (item.get("baseUrl") or item.get("base_url"))]
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: int(item.get("bandwidth") or 0), reverse=True)[0]


def _download_audio_via_playurl(
    video_info: dict,
    page: dict,
    *,
    page_no: int,
    work_dir: str,
    file_stem: str,
) -> str:
    cid = _find_page_cid(video_info, page_no, page)
    if cid <= 0:
        raise RuntimeError("未找到分P cid，无法通过 playurl 下载音频。")

    response = requests.get(
        "https://api.bilibili.com/x/player/playurl",
        params={
            "bvid": video_info["bvid"],
            "cid": cid,
            "fnval": 16,
            "fourk": 1,
        },
        headers=config.BASE_HEADERS,
        timeout=20,
    )
    payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(f"playurl 获取失败：{payload.get('message', '未知错误')}")

    dash = (payload.get("data") or {}).get("dash") or {}
    selected_audio = _select_playurl_audio(dash.get("audio") or [])
    if not selected_audio:
        raise RuntimeError("playurl 未返回可用音频轨。")

    urls = [
        selected_audio.get("baseUrl") or selected_audio.get("base_url"),
        *(selected_audio.get("backupUrl") or selected_audio.get("backup_url") or []),
    ]
    urls = [str(url) for url in urls if url]
    headers = {
        **config.BASE_HEADERS,
        "Referer": _build_page_url(video_info, page_no),
        "Origin": "https://www.bilibili.com",
    }

    last_error: Exception | None = None
    for index, url in enumerate(urls, start=1):
        target_path = os.path.join(work_dir, f"{file_stem}.playurl.{index}.m4s")
        try:
            with requests.get(url, headers=headers, stream=True, timeout=60) as media_response:
                media_response.raise_for_status()
                with open(target_path, "wb") as file:
                    for chunk in media_response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            file.write(chunk)
            if os.path.getsize(target_path) > 0:
                return target_path
        except Exception as exc:
            last_error = exc
            try:
                if os.path.exists(target_path):
                    os.remove(target_path)
            except OSError:
                pass

    raise RuntimeError(f"playurl 音频下载失败：{last_error}")


def _normalize_audio(input_path: str, output_path: str, *, provider_api: str) -> str:
    profile = _audio_profile(provider_api)
    _run_ffmpeg(
        [
            "-y",
            "-i",
            input_path,
            "-vn",
            "-ac",
            str(TARGET_CHANNELS),
            "-ar",
            str(TARGET_SAMPLE_RATE),
            *profile["encode_args"],
            output_path,
        ],
        "音频压缩",
    )
    return output_path


def _split_audio_if_needed(
    input_path: str,
    chunks_dir: str,
    *,
    start_offset: float = 0.0,
    depth: int = 0,
    provider_api: str = "local_sensevoice",
) -> list[dict]:
    duration = _probe_duration_seconds(input_path)
    max_chunk_seconds = _max_chunk_seconds(provider_api)
    file_size = os.path.getsize(input_path)
    if file_size <= TARGET_AUDIO_MAX_BYTES and duration <= max_chunk_seconds:
        return [{"path": input_path, "offset": start_offset, "duration": duration}]

    size_chunk_count = max(1, math.ceil(file_size / TARGET_AUDIO_MAX_BYTES))
    time_chunk_count = max(1, math.ceil(duration / max_chunk_seconds))
    chunk_count = max(2, size_chunk_count, time_chunk_count)
    chunk_duration = max(60.0, duration / chunk_count)
    profile = _audio_profile(provider_api)

    chunks: list[dict] = []
    current = 0.0
    index = 1
    while current < duration - 0.5:
        remaining = duration - current
        segment_duration = min(chunk_duration, remaining)
        chunk_path = os.path.join(chunks_dir, f"chunk_{depth}_{index:02d}.{profile['extension']}")
        _run_ffmpeg(
            [
                "-y",
                "-ss",
                f"{current:.3f}",
                "-i",
                input_path,
                "-t",
                f"{segment_duration:.3f}",
                "-vn",
                "-ac",
                str(TARGET_CHANNELS),
                "-ar",
                str(TARGET_SAMPLE_RATE),
                *profile["encode_args"],
                chunk_path,
            ],
            "音频切片",
        )
        if os.path.getsize(chunk_path) > TARGET_AUDIO_MAX_BYTES and depth < 2 and segment_duration > 90:
            chunks.extend(
                _split_audio_if_needed(
                    chunk_path,
                    chunks_dir,
                    start_offset=start_offset + current,
                    depth=depth + 1,
                    provider_api=provider_api,
                )
            )
        else:
            chunks.append({"path": chunk_path, "offset": start_offset + current, "duration": segment_duration})
        current += segment_duration
        index += 1

    return chunks


def _split_transcript_text(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    if not normalized:
        return []

    rough_parts = [
        part.strip()
        for part in re.split(r"(?<=[。！？!?；;])\s*|(?<=，)\s+", normalized)
        if part and part.strip()
    ]
    if len(rough_parts) <= 1:
        rough_parts = []
        current = ""
        for char in normalized:
            current += char
            should_cut = len(current) >= TRANSCRIPT_SEGMENT_TARGET_CHARS and char in "，,。！？!?；;、 "
            if should_cut or len(current) >= TRANSCRIPT_SEGMENT_MAX_CHARS:
                rough_parts.append(current.strip())
                current = ""
        if current.strip():
            rough_parts.append(current.strip())

    segments: list[str] = []
    current = ""
    for part in rough_parts:
        if not part:
            continue
        if current and len(current) + len(part) > TRANSCRIPT_SEGMENT_MAX_CHARS:
            segments.append(current.strip())
            current = part
        else:
            current = f"{current}{part}" if current else part
        if len(current) >= TRANSCRIPT_SEGMENT_TARGET_CHARS:
            segments.append(current.strip())
            current = ""
    if current.strip():
        segments.append(current.strip())
    return segments or [normalized]


def _entries_from_plain_text(text: str, offset: float, duration: float) -> list[dict]:
    segments = _split_transcript_text(text)
    if not segments:
        return []
    total_chars = max(1, sum(len(segment) for segment in segments))
    effective_duration = duration if duration > 0 else max(float(len(text)) / 7.0, float(len(segments)) * 4.0)
    cursor = offset
    entries: list[dict] = []
    for index, segment in enumerate(segments):
        if index == len(segments) - 1:
            end = offset + effective_duration
        else:
            end = cursor + effective_duration * (len(segment) / total_chars)
        entries.append({"from": cursor, "to": max(end, cursor + 0.2), "content": segment})
        cursor = end
    return entries


def _payload_to_entries(payload: dict, offset: float, duration: float = 0.0) -> list[dict]:
    segments = payload.get("segments") or []
    entries: list[dict] = []
    for segment in segments:
        content = str(segment.get("text", "")).strip()
        if not content:
            continue
        start = float(segment.get("start", 0.0)) + offset
        end = float(segment.get("end", start)) + offset
        entries.append(
            {
                "from": start,
                "to": max(end, start),
                "content": content,
            }
        )

    if entries:
        return entries

    text = str(payload.get("text", "")).strip()
    if text:
        return _entries_from_plain_text(text, offset, duration)
    return []


def _safe_slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", (value or "").strip())
    return cleaned.strip("._-") or "item"


def _audio_prepare_cache_root(video_info: dict, provider_api: str) -> str:
    root = os.path.join(
        config.ensure_cache_dir(),
        "audio_prepare",
        str(video_info.get("bvid") or "unknown").lower(),
        provider_api,
    )
    os.makedirs(root, exist_ok=True)
    return root


def _audio_prepare_cache_paths(video_info: dict, page_no: int, provider_api: str) -> tuple[str, str]:
    root = _audio_prepare_cache_root(video_info, provider_api)
    page_dir = os.path.join(root, f"page_{page_no:02d}")
    manifest_path = os.path.join(page_dir, "manifest.json")
    return page_dir, manifest_path


def _chunk_transcript_cache_dir(video_info: dict, page_no: int, provider_api: str) -> str:
    page_dir, _ = _audio_prepare_cache_paths(video_info, page_no, provider_api)
    cache_dir = os.path.join(page_dir, "transcripts")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def _provider_model(provider_api: str) -> str:
    return local_audio_client.get_model()


def _page_chunk_signature(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "name": os.path.basename(str(chunk.get("path") or "")),
            "offset": round(float(chunk.get("offset") or 0.0), 3),
            "duration": round(float(chunk.get("duration") or 0.0), 3),
        }
        for chunk in chunks
    ]


def _page_transcript_cache_path(video_info: dict, page_no: int, provider_api: str) -> str:
    page_dir, _ = _audio_prepare_cache_paths(video_info, page_no, provider_api)
    return os.path.join(page_dir, "page-transcript.json")


def _load_cached_page_transcript(
    video_info: dict,
    *,
    page_no: int,
    page_label: str,
    provider_api: str,
    prompt: str,
    language: str | None,
    chunks: list[dict[str, Any]],
) -> list[dict[str, Any]] | None:
    cache_path = _page_transcript_cache_path(video_info, page_no, provider_api)
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None
    if str(payload.get("version") or "") != PAGE_TRANSCRIPT_CACHE_VERSION:
        return None
    if str(payload.get("provider_api") or "") != provider_api:
        return None
    if str(payload.get("model") or "") != _provider_model(provider_api):
        return None
    if str(payload.get("language") or "") != (language or "").strip():
        return None
    if str(payload.get("page_label") or "") != page_label:
        return None
    if str(payload.get("prompt") or "") != prompt.strip():
        return None
    if payload.get("chunk_signature") != _page_chunk_signature(chunks):
        return None

    entries = payload.get("entries")
    if not isinstance(entries, list):
        return None
    normalized_entries: list[dict[str, Any]] = []
    for item in entries:
        if not isinstance(item, dict):
            return None
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        normalized_entries.append(
            {
                "from": float(item.get("from", 0.0)),
                "to": float(item.get("to", item.get("from", 0.0))),
                "content": content,
            }
        )
    return normalized_entries or None


def _save_cached_page_transcript(
    video_info: dict,
    *,
    page_no: int,
    page_label: str,
    provider_api: str,
    prompt: str,
    language: str | None,
    chunks: list[dict[str, Any]],
    entries: list[dict[str, Any]],
) -> None:
    cache_path = _page_transcript_cache_path(video_info, page_no, provider_api)
    payload = {
        "version": PAGE_TRANSCRIPT_CACHE_VERSION,
        "provider_api": provider_api,
        "model": _provider_model(provider_api),
        "language": (language or "").strip(),
        "page_label": page_label,
        "prompt": prompt.strip(),
        "chunk_signature": _page_chunk_signature(chunks),
        "entries": entries,
    }
    with open(cache_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def _chunk_transcript_cache_path(
    video_info: dict,
    *,
    page_no: int,
    provider_api: str,
    chunk_path: str,
    offset: float,
    prompt: str,
    language: str | None,
) -> str:
    cache_dir = _chunk_transcript_cache_dir(video_info, page_no, provider_api)
    key_payload = {
        "version": TRANSCRIPT_CHUNK_CACHE_VERSION,
        "provider_api": provider_api,
        "model": _provider_model(provider_api),
        "language": (language or "").strip(),
        "offset": round(float(offset), 3),
        "chunk_name": os.path.basename(chunk_path),
        "prompt": prompt.strip(),
    }
    serialized = json.dumps(key_payload, ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha1(serialized.encode("utf-8")).hexdigest()[:16]
    stem = os.path.splitext(os.path.basename(chunk_path))[0]
    return os.path.join(cache_dir, f"{_safe_slug(stem)}.{digest}.json")


def _load_cached_chunk_entries(
    video_info: dict,
    *,
    page_no: int,
    provider_api: str,
    chunk_path: str,
    offset: float,
    prompt: str,
    language: str | None,
) -> list[dict[str, Any]] | None:
    cache_path = _chunk_transcript_cache_path(
        video_info,
        page_no=page_no,
        provider_api=provider_api,
        chunk_path=chunk_path,
        offset=offset,
        prompt=prompt,
        language=language,
    )
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if str(payload.get("version") or "") != TRANSCRIPT_CHUNK_CACHE_VERSION:
        return None
    entries = payload.get("entries")
    if not isinstance(entries, list):
        return None
    normalized_entries = []
    for item in entries:
        if not isinstance(item, dict):
            return None
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        normalized_entries.append(
            {
                "from": float(item.get("from", 0.0)),
                "to": float(item.get("to", item.get("from", 0.0))),
                "content": content,
            }
        )
    return normalized_entries or None


def _save_cached_chunk_entries(
    video_info: dict,
    *,
    page_no: int,
    provider_api: str,
    chunk_path: str,
    offset: float,
    prompt: str,
    language: str | None,
    entries: list[dict[str, Any]],
) -> None:
    cache_path = _chunk_transcript_cache_path(
        video_info,
        page_no=page_no,
        provider_api=provider_api,
        chunk_path=chunk_path,
        offset=offset,
        prompt=prompt,
        language=language,
    )
    payload = {
        "version": TRANSCRIPT_CHUNK_CACHE_VERSION,
        "provider_api": provider_api,
        "model": _provider_model(provider_api),
        "language": (language or "").strip(),
        "offset": round(float(offset), 3),
        "entries": entries,
    }
    with open(cache_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def _load_prepared_page_audio(
    video_info: dict,
    *,
    page_no: int,
    page_label: str,
    provider_api: str,
) -> PreparedPageAudio | None:
    page_dir, manifest_path = _audio_prepare_cache_paths(video_info, page_no, provider_api)
    if not os.path.exists(manifest_path):
        return None
    try:
        with open(manifest_path, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None
    if str(payload.get("version") or "") != AUDIO_PREPARE_CACHE_VERSION:
        return None
    if int(payload.get("page_no") or 0) != page_no:
        return None
    if str(payload.get("provider_api") or "") != provider_api:
        return None
    if str(payload.get("max_chunk_seconds") or "") != str(_max_chunk_seconds(provider_api)):
        return None

    chunks_raw = payload.get("chunks") or []
    chunks: list[dict[str, Any]] = []
    for item in chunks_raw:
        if not isinstance(item, dict):
            return None
        relative_path = str(item.get("relative_path") or "").strip()
        chunk_path = os.path.join(page_dir, relative_path)
        if not relative_path or not os.path.exists(chunk_path):
            return None
        chunks.append(
            {
                "path": chunk_path,
                "offset": float(item.get("offset") or 0.0),
                "duration": float(item.get("duration") or 0.0),
            }
        )

    if not chunks:
        return None
    return PreparedPageAudio(page_no=page_no, page_label=page_label, chunks=chunks)


def _save_prepared_page_audio(
    video_info: dict,
    *,
    page_no: int,
    page_label: str,
    provider_api: str,
    chunks: list[dict[str, Any]],
) -> PreparedPageAudio:
    page_dir, manifest_path = _audio_prepare_cache_paths(video_info, page_no, provider_api)
    os.makedirs(page_dir, exist_ok=True)

    cached_chunks: list[dict[str, Any]] = []
    manifest_chunks: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks, start=1):
        source_path = str(chunk.get("path") or "").strip()
        if not source_path or not os.path.exists(source_path):
            continue
        extension = os.path.splitext(source_path)[1] or f".{_audio_profile(provider_api)['extension']}"
        target_name = f"chunk_{index:02d}{extension}"
        target_path = os.path.join(page_dir, target_name)
        if os.path.abspath(source_path) != os.path.abspath(target_path):
            with open(source_path, "rb") as src, open(target_path, "wb") as dst:
                dst.write(src.read())
        offset = float(chunk.get("offset") or 0.0)
        duration = float(chunk.get("duration") or 0.0)
        cached_chunks.append({"path": target_path, "offset": offset, "duration": duration})
        manifest_chunks.append({"relative_path": target_name, "offset": offset, "duration": duration})

    payload = {
        "version": AUDIO_PREPARE_CACHE_VERSION,
        "page_no": page_no,
        "page_label": page_label,
        "provider_api": provider_api,
        "max_chunk_seconds": _max_chunk_seconds(provider_api),
        "chunks": manifest_chunks,
    }
    with open(manifest_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)

    return PreparedPageAudio(page_no=page_no, page_label=page_label, chunks=cached_chunks)


def _transcribe_prepared_page(
    video_info: dict,
    prepared: PreparedPageAudio,
    *,
    provider_label: str,
    provider_api: str,
    language: str | None,
    progress_callback: ProgressCallback | None,
) -> TranscribedPageResult:
    _emit(
        progress_callback,
        f"方案2：正在提交 {prepared.page_label} 到{provider_label} 转写（共 {len(prepared.chunks)} 段）...",
        72,
    )

    entries: list[dict[str, Any]] = []
    prompt = _build_transcription_prompt(video_info, prepared.page_label)
    cached_page_entries = _load_cached_page_transcript(
        video_info,
        page_no=prepared.page_no,
        page_label=prepared.page_label,
        provider_api=provider_api,
        prompt=prompt,
        language=language,
        chunks=prepared.chunks,
    )
    if cached_page_entries:
        _emit(
            progress_callback,
            f"方案2：{prepared.page_label} 命中整页转写缓存，无需重新提交模型。",
            76,
        )
        return TranscribedPageResult(
            page_no=prepared.page_no,
            page_label=prepared.page_label,
            entries=cached_page_entries,
        )

    cached_entries_by_chunk: dict[int, list[dict[str, Any]]] = {}
    pending_chunks: list[tuple[int, dict[str, Any]]] = []
    for chunk_index, chunk in enumerate(prepared.chunks, start=1):
        offset = float(chunk["offset"])
        cached_entries = _load_cached_chunk_entries(
            video_info,
            page_no=prepared.page_no,
            provider_api=provider_api,
            chunk_path=str(chunk["path"]),
            offset=offset,
            prompt=prompt,
            language=language,
        )
        if cached_entries:
            cached_entries_by_chunk[chunk_index] = cached_entries
            entries.extend(cached_entries)
            continue
        pending_chunks.append((chunk_index, chunk))

    if cached_entries_by_chunk:
        _emit(
            progress_callback,
            (
                f"方案2：{prepared.page_label} 命中 {len(cached_entries_by_chunk)}/{len(prepared.chunks)} 段转写缓存，"
                + ("无需重复转写。" if len(cached_entries_by_chunk) == len(prepared.chunks) else "继续补齐剩余片段...")
            ),
            76,
        )

    if not pending_chunks:
        normalized_entries = [entry for entry in entries if str(entry.get("content", "")).strip()]
        normalized_entries.sort(key=lambda item: (float(item.get("from", 0.0)), float(item.get("to", 0.0))))
        if not normalized_entries:
            raise RuntimeError("未转写出有效文本。")
        _save_cached_page_transcript(
            video_info,
            page_no=prepared.page_no,
            page_label=prepared.page_label,
            provider_api=provider_api,
            prompt=prompt,
            language=language,
            chunks=prepared.chunks,
            entries=normalized_entries,
        )
        return TranscribedPageResult(
            page_no=prepared.page_no,
            page_label=prepared.page_label,
            entries=normalized_entries,
        )

    if provider_api != "local_sensevoice" and len(prepared.chunks) > 1:
        def _transcribe_chunk_job(chunk_index: int, chunk: dict[str, Any]) -> list[dict[str, Any]]:
            _emit(
                progress_callback,
                f"方案2：{provider_label} 并行转写 {prepared.page_label} 第 {chunk_index}/{len(prepared.chunks)} 段...",
                78,
            )
            payload = _transcribe_chunk(
                provider_api,
                chunk["path"],
                prompt=prompt,
                language=language,
            )
            chunk_entries = _payload_to_entries(
                payload,
                float(chunk["offset"]),
                float(chunk.get("duration") or 0.0),
            )
            _save_cached_chunk_entries(
                video_info,
                page_no=prepared.page_no,
                provider_api=provider_api,
                chunk_path=str(chunk["path"]),
                offset=float(chunk["offset"]),
                prompt=prompt,
                language=language,
                entries=chunk_entries,
            )
            return chunk_entries

        chunk_workers = min(len(pending_chunks), AUDIO_CHUNK_WORKERS)
        with ThreadPoolExecutor(max_workers=chunk_workers) as executor:
            chunk_futures = {
                executor.submit(_transcribe_chunk_job, chunk_index, chunk): chunk_index
                for chunk_index, chunk in pending_chunks
            }
            for future in as_completed(chunk_futures):
                entries.extend(future.result())
    else:
        for chunk_index, chunk in pending_chunks:
            _emit(
                progress_callback,
                f"方案2：{provider_label} 正在转写 {prepared.page_label} 第 {chunk_index}/{len(prepared.chunks)} 段...",
                78,
            )
            payload = _transcribe_chunk(
                provider_api,
                chunk["path"],
                prompt=prompt,
                language=language,
            )
            chunk_entries = _payload_to_entries(
                payload,
                float(chunk["offset"]),
                float(chunk.get("duration") or 0.0),
            )
            _save_cached_chunk_entries(
                video_info,
                page_no=prepared.page_no,
                provider_api=provider_api,
                chunk_path=str(chunk["path"]),
                offset=float(chunk["offset"]),
                prompt=prompt,
                language=language,
                entries=chunk_entries,
            )
            entries.extend(chunk_entries)

    normalized_entries = [entry for entry in entries if str(entry.get("content", "")).strip()]
    normalized_entries.sort(key=lambda item: (float(item.get("from", 0.0)), float(item.get("to", 0.0))))
    if not normalized_entries:
        raise RuntimeError("未转写出有效文本。")
    _save_cached_page_transcript(
        video_info,
        page_no=prepared.page_no,
        page_label=prepared.page_label,
        provider_api=provider_api,
        prompt=prompt,
        language=language,
        chunks=prepared.chunks,
        entries=normalized_entries,
    )

    return TranscribedPageResult(
        page_no=prepared.page_no,
        page_label=prepared.page_label,
        entries=normalized_entries,
    )


def _transcribe_prepared_pages_local(
    video_info: dict,
    prepared_pages: list[PreparedPageAudio],
    *,
    provider_label: str,
    provider_api: str,
    language: str | None,
    progress_callback: ProgressCallback | None,
) -> list[TranscribedPageResult]:
    if not prepared_pages:
        return []

    page_state: dict[int, dict[str, Any]] = {}
    batch_items: list[dict[str, Any]] = []

    for page_index, prepared in enumerate(prepared_pages, start=1):
        prompt = _build_transcription_prompt(video_info, prepared.page_label)
        _emit(
            progress_callback,
            f"方案2：检查 {prepared.page_label} 的本地转写缓存（{page_index}/{len(prepared_pages)}）...",
            72,
        )
        cached_page_entries = _load_cached_page_transcript(
            video_info,
            page_no=prepared.page_no,
            page_label=prepared.page_label,
            provider_api=provider_api,
            prompt=prompt,
            language=language,
            chunks=prepared.chunks,
        )
        if cached_page_entries:
            page_state[prepared.page_no] = {
                "prepared": prepared,
                "prompt": prompt,
                "entries": list(cached_page_entries),
                "pending_count": 0,
            }
            continue

        entries: list[dict[str, Any]] = []
        pending_count = 0
        for chunk_index, chunk in enumerate(prepared.chunks, start=1):
            offset = float(chunk["offset"])
            cached_entries = _load_cached_chunk_entries(
                video_info,
                page_no=prepared.page_no,
                provider_api=provider_api,
                chunk_path=str(chunk["path"]),
                offset=offset,
                prompt=prompt,
                language=language,
            )
            if cached_entries:
                entries.extend(cached_entries)
                continue

            pending_count += 1
            item_id = f"p{prepared.page_no:04d}_c{chunk_index:04d}"
            batch_items.append(
                {
                    "id": item_id,
                    "file_path": str(chunk["path"]),
                    "page_no": prepared.page_no,
                    "chunk_index": chunk_index,
                    "chunk_path": str(chunk["path"]),
                    "offset": offset,
                    "duration": float(chunk.get("duration") or 0.0),
                    "prompt": prompt,
                }
            )

        page_state[prepared.page_no] = {
            "prepared": prepared,
            "prompt": prompt,
            "entries": entries,
            "pending_count": pending_count,
        }

    if batch_items:
        _emit(
            progress_callback,
            f"方案2：本地 SenseVoice 批量转写 {len(batch_items)} 个音频片段，模型只启动一次...",
            76,
        )
        meta_by_id = {str(item["id"]): item for item in batch_items}
        processed_ids: set[str] = set()

        def _persist_streamed_payload(payload: dict[str, Any]) -> None:
            item_id = str(payload.get("id") or "")
            meta = meta_by_id.get(item_id)
            if not meta or item_id in processed_ids:
                return
            processed_ids.add(item_id)
            chunk_entries = _payload_to_entries(payload, float(meta["offset"]), float(meta["duration"]))
            _save_cached_chunk_entries(
                video_info,
                page_no=int(meta["page_no"]),
                provider_api=provider_api,
                chunk_path=str(meta["chunk_path"]),
                offset=float(meta["offset"]),
                prompt=str(meta["prompt"]),
                language=language,
                entries=chunk_entries,
            )
            page_state[int(meta["page_no"])]["entries"].extend(chunk_entries)
            _emit(
                progress_callback,
                f"方案2：本地 SenseVoice 已缓存 {len(processed_ids)}/{len(batch_items)} 个音频片段...",
                78,
            )

        payloads = local_audio_client.transcribe_audio_files(
            batch_items,
            language=language,
            result_callback=_persist_streamed_payload,
        )
        payload_by_id = {str(payload.get("id") or ""): payload for payload in payloads}
        for item_id, meta in meta_by_id.items():
            if item_id in processed_ids:
                continue
            payload = payload_by_id.get(item_id)
            if not payload:
                raise RuntimeError(f"本地批量转写缺少结果：{item_id}")
            _persist_streamed_payload(payload)

    results: list[TranscribedPageResult] = []
    for prepared in prepared_pages:
        state = page_state.get(prepared.page_no)
        if not state:
            continue
        normalized_entries = [entry for entry in state["entries"] if str(entry.get("content", "")).strip()]
        normalized_entries.sort(key=lambda item: (float(item.get("from", 0.0)), float(item.get("to", 0.0))))
        if not normalized_entries:
            raise RuntimeError(f"{prepared.page_label} 未转写出有效文本。")
        _save_cached_page_transcript(
            video_info,
            page_no=prepared.page_no,
            page_label=prepared.page_label,
            provider_api=provider_api,
            prompt=str(state["prompt"]),
            language=language,
            chunks=prepared.chunks,
            entries=normalized_entries,
        )
        results.append(
            TranscribedPageResult(
                page_no=prepared.page_no,
                page_label=prepared.page_label,
                entries=normalized_entries,
            )
        )

    return results


def _transcription_worker_count(provider_api: str, page_count: int) -> int:
    if provider_api == "local_sensevoice":
        return min(max(1, page_count), LOCAL_AUDIO_TRANSCRIBE_WORKERS)
    return min(max(1, page_count), AUDIO_TRANSCRIBE_WORKERS)


def _prepare_page_audio(
    video_info: dict,
    page: dict,
    *,
    index: int,
    total_pages: int,
    provider_api: str,
    progress_callback: ProgressCallback | None,
) -> PreparedPageAudio:
    page_no = int(page.get("page") or index)
    page_part = str(page.get("part") or "").strip() or f"P{page_no}"
    page_label = str(page.get("label") or f"P{page_no}：{page_part}")
    cached = _load_prepared_page_audio(
        video_info,
        page_no=page_no,
        page_label=page_label,
        provider_api=provider_api,
    )
    if cached:
        _emit(progress_callback, f"方案2：命中 {page_label} 的音频预处理缓存，跳过下载与切片…", 64)
        return cached

    prepare_root = os.path.join(
        config.ensure_temp_dir(),
        "audio_prepare",
        str(video_info.get("bvid") or "unknown").lower(),
        provider_api,
        "_work",
    )
    file_stem = _sanitize_stem(f"{video_info['bvid']}_p{page_no}")
    page_dir = os.path.join(prepare_root, f"page_{page_no:02d}")
    os.makedirs(page_dir, exist_ok=True)
    try:
        _emit(progress_callback, f"方案2：正在下载 {page_label} 的音频（{index}/{total_pages}）...", 54)
        try:
            source_path = _download_audio(_build_page_url(video_info, page_no), page_dir, file_stem)
        except Exception as exc:
            _emit(
                progress_callback,
                f"方案2：{page_label} yt-dlp 下载失败，改用 playurl 直连兜底：{exc}",
                58,
            )
            source_path = _download_audio_via_playurl(
                video_info,
                page,
                page_no=page_no,
                work_dir=page_dir,
                file_stem=file_stem,
            )

        normalized_ext = _audio_profile(provider_api)["extension"]
        normalized_path = os.path.join(page_dir, f"{file_stem}_16k.{normalized_ext}")
        _emit(progress_callback, f"方案2：正在压缩 {page_label} 的音频...", 62)
        _normalize_audio(source_path, normalized_path, provider_api=provider_api)

        chunk_dir = os.path.join(page_dir, "chunks")
        os.makedirs(chunk_dir, exist_ok=True)
        chunks = _split_audio_if_needed(normalized_path, chunk_dir, provider_api=provider_api)
        return _save_prepared_page_audio(
            video_info,
            page_no=page_no,
            page_label=page_label,
            provider_api=provider_api,
            chunks=chunks,
        )
    finally:
        shutil.rmtree(page_dir, ignore_errors=True)


def transcribe_video_pages(
    video_info: dict,
    pages: list[dict],
    progress_callback: ProgressCallback | None = None,
    page_result_callback: PageResultCallback | None = None,
) -> TranscriptionBundle:
    provider_label, provider_api, provider_model = _resolve_transcription_backend()
    if not pages:
        return TranscriptionBundle([], 0, [], 0, "未启用音频转写", provider_api, "没有需要转写的分P。", provider_model)

    language = _guess_language(video_info)
    transcribed_segments: list[dict] = []
    pages_without_text: list[str] = []
    total_entries = 0

    prepare_futures: dict[Future[PreparedPageAudio], tuple[int, dict]] = {}
    transcribe_workers = _transcription_worker_count(provider_api, len(pages))

    with ThreadPoolExecutor(max_workers=min(AUDIO_PREPARE_WORKERS, max(1, len(pages)))) as executor:
        for index, page in enumerate(pages, start=1):
            future = executor.submit(
                _prepare_page_audio,
                video_info,
                page,
                index=index,
                total_pages=len(pages),
                provider_api=provider_api,
                progress_callback=progress_callback,
            )
            prepare_futures[future] = (index, page)

        if provider_api == "local_sensevoice":
            prepared_pages: list[PreparedPageAudio] = []
            for future in as_completed(prepare_futures):
                index, page = prepare_futures[future]
                page_no = int(page.get("page") or index)
                page_part = str(page.get("part") or "").strip() or f"P{page_no}"
                page_label = str(page.get("label") or f"P{page_no}：{page_part}")
                try:
                    prepared_pages.append(future.result())
                except Exception as exc:
                    pages_without_text.append(page_label)
                    _emit(progress_callback, f"方案2：{page_label} 音频准备失败：{exc}", 68)

            prepared_pages.sort(key=lambda item: item.page_no)
            if prepared_pages:
                try:
                    local_results = _transcribe_prepared_pages_local(
                        video_info,
                        prepared_pages,
                        provider_label=provider_label,
                        provider_api=provider_api,
                        language=language,
                        progress_callback=progress_callback,
                    )
                    for result in local_results:
                        total_entries += len(result.entries)
                        segment = {
                            "page": result.page_no,
                            "label": result.page_label,
                            "entries": result.entries,
                        }
                        transcribed_segments.append(segment)
                        if page_result_callback:
                            page_result_callback(
                                {
                                    "page": result.page_no,
                                    "label": result.page_label,
                                    "entries": result.entries,
                                    "provider_label": provider_label,
                                    "provider_api": provider_api,
                                    "provider_model": provider_model,
                                }
                            )
                        _emit(progress_callback, f"方案2：{result.page_label} 转写完成，共 {len(result.entries)} 条文本。", 82)
                except Exception as exc:
                    failed_labels = [item.page_label for item in prepared_pages]
                    pages_without_text.extend(label for label in failed_labels if label not in pages_without_text)
                    _emit(progress_callback, f"方案2：本地批量转写失败：{exc}", 82)

            transcribe_futures = {}
        else:
            transcribe_futures: dict[Future[TranscribedPageResult], str] = {}
            with ThreadPoolExecutor(max_workers=transcribe_workers) as transcribe_executor:
                for future in as_completed(prepare_futures):
                    index, page = prepare_futures[future]
                    page_no = int(page.get("page") or index)
                    page_part = str(page.get("part") or "").strip() or f"P{page_no}"
                    page_label = str(page.get("label") or f"P{page_no}：{page_part}")
                    try:
                        prepared = future.result()
                    except Exception as exc:
                        pages_without_text.append(page_label)
                        _emit(progress_callback, f"方案2：{page_label} 音频准备失败：{exc}", 68)
                        continue

                    transcribe_future = transcribe_executor.submit(
                        _transcribe_prepared_page,
                        video_info,
                        prepared,
                        provider_label=provider_label,
                        provider_api=provider_api,
                        language=language,
                        progress_callback=progress_callback,
                    )
                    transcribe_futures[transcribe_future] = prepared.page_label

                for future in as_completed(transcribe_futures):
                    page_label = transcribe_futures[future]
                    try:
                        result = future.result()
                        total_entries += len(result.entries)
                        segment = {
                            "page": result.page_no,
                            "label": result.page_label,
                            "entries": result.entries,
                        }
                        transcribed_segments.append(segment)
                        if page_result_callback:
                            page_result_callback(
                                {
                                    "page": result.page_no,
                                    "label": result.page_label,
                                    "entries": result.entries,
                                    "provider_label": provider_label,
                                    "provider_api": provider_api,
                                    "provider_model": provider_model,
                                }
                            )
                        _emit(progress_callback, f"方案2：{result.page_label} 转写完成，共 {len(result.entries)} 条文本。", 82)
                    except Exception as exc:
                        pages_without_text.append(page_label)
                        _emit(progress_callback, f"方案2：{page_label} 转写失败：{exc}", 82)

        if provider_api == "local_sensevoice":
            pass
        else:
            return _finish_transcription_bundle(
                transcribed_segments,
                pages,
                pages_without_text,
                total_entries,
                provider_label,
                provider_api,
                provider_model,
            )

    return _finish_transcription_bundle(
        transcribed_segments,
        pages,
        pages_without_text,
        total_entries,
        provider_label,
        provider_api,
        provider_model,
    )


def _finish_transcription_bundle(
    transcribed_segments: list[dict],
    pages: list[dict],
    pages_without_text: list[str],
    total_entries: int,
    provider_label: str,
    provider_api: str,
    provider_model: str,
) -> TranscriptionBundle:
    subtitles: list[dict] = []
    if transcribed_segments:
        transcribed_segments.sort(key=lambda item: int(item.get("page") or 0))
        subtitles = [
            {
                "lang": f"{provider_label}音频转写",
                "lan": f"zh-{provider_api}-transcript",
                "entries": [entry for segment in transcribed_segments for entry in segment["entries"]],
                "page_segments": [
                    {
                        "page": segment["page"],
                        "label": segment["label"],
                        "entries": segment["entries"],
                    }
                    for segment in transcribed_segments
                ],
            }
        ]

    note = (
        f"已使用 {provider_model} 转写 {len(transcribed_segments)}/{len(pages)} 个分P，"
        f"共得到 {total_entries} 条文本。"
    )
    if pages_without_text:
        note += f" 未成功转写：{'；'.join(pages_without_text)}。"

    return TranscriptionBundle(
        subtitles=subtitles,
        pages_transcribed=len(transcribed_segments),
        pages_without_text=pages_without_text,
        entry_count=total_entries,
        source_type=f"{provider_label} 音频转写",
        source_api=provider_api,
        note=note,
        model=provider_model,
    )
