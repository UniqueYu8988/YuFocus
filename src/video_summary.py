# -*- coding: utf-8 -*-
"""Local-first video summary workbench.

This is intentionally separate from the Codex course making pipeline. It reuses
the local subtitle/transcription material layer, then writes a compact Markdown
summary for quick archiving and review.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
import re
from typing import Any

import requests

import config
import distiller


SUMMARY_RESULT_PREFIX = "__SHIJIE_VIDEO_SUMMARY_RESULT__="
SUMMARY_MODEL_TIMEOUT = 180
AD_MARKERS = (
    "本期视频由",
    "本视频由",
    "感谢",
    "赞助播出",
    "合作推广",
    "广告",
    "恰饭",
    "下单",
    "购买",
    "优惠",
    "折扣",
    "券",
    "链接",
    "点击",
    "种草",
    "安利",
    "推荐给大家",
    "推荐大家",
    "强烈推荐",
    "入手",
    "开箱",
    "体验一下",
    "加速器",
    "免费加速",
)
AD_BRANDS = (
    "OPPO",
    "小米",
    "华为",
    "vivo",
    "荣耀",
    "Apple",
    "iPhone",
    "京东",
    "淘宝",
    "天猫",
    "拼多多",
    "BiuBiu",
    "biubiu",
)


def _clean_text(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"^(然后|那么|所以|就是|这个|那个|接下来)[，,、\s]*", "", text)
    return text.strip()


def _split_sentences(text: str) -> list[str]:
    sentences = []
    for item in re.split(r"(?<=[。！？；;!?])\s*", text or ""):
        clean = _clean_text(item)
        if 18 <= len(clean) <= 180 and not re.search(r"(三连|关注|投币|点赞|下期|弹幕|评论区|兄弟们|哈哈)", clean):
            sentences.append(clean)
    return sentences


def _looks_like_ad_line(text: str) -> bool:
    normalized = (text or "").strip()
    if not normalized:
        return False
    marker_hits = sum(1 for marker in AD_MARKERS if marker in normalized)
    brand_hits = sum(1 for brand in AD_BRANDS if brand.lower() in normalized.lower())
    if marker_hits >= 2:
        return True
    if marker_hits >= 1 and brand_hits >= 1:
        return True
    if brand_hits >= 1 and ("手表" in normalized or "watch" in normalized.lower() or "加速" in normalized):
        return True
    return False


def _filter_transcript_ads(text: str) -> str:
    """Best-effort port of 知语狸's ad skipping for timestamped transcript text."""
    if not text:
        return ""

    result_lines: list[str] = []
    skip_until = -1.0
    entry_pattern = re.compile(r"\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]\s*([^\[]+)")
    for line in text.splitlines():
        if line.startswith("## "):
            result_lines.append(line)
            continue

        entries = []
        for match in entry_pattern.finditer(line):
            start = float(match.group(1))
            end = float(match.group(2))
            content = _clean_text(match.group(3))
            if start < skip_until:
                continue
            if _looks_like_ad_line(content):
                skip_until = end + 25.0
                continue
            entries.append(f"[{start:.1f}-{end:.1f}] {content}")

        if entries:
            result_lines.append(" ".join(entries))
        elif not entry_pattern.search(line) and line.strip():
            if not _looks_like_ad_line(line):
                result_lines.append(line)

    cleaned = "\n".join(result_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned or text


def _sentence_score(sentence: str, title: str) -> int:
    score = 0
    if re.search(r"\d|%|倍|分钟|小时|版本|模型|参数|步骤|阶段|方法|问题|原因|结果|风险|建议", sentence):
        score += 3
    if re.search(r"不是|而是|关键|核心|本质|必须|需要|容易|避免|如果|因为|所以|但是", sentence):
        score += 3
    for token in re.split(r"[，。、“”‘’：；（）()\[\]【】、《》\s/]+", title):
        if len(token) >= 2 and token in sentence:
            score += 2
    score += min(4, len(sentence) // 28)
    return score


def _dedupe_sentences(sentences: list[str], limit: int) -> list[str]:
    selected: list[str] = []
    seen_tokens: set[str] = set()
    for sentence in sentences:
        tokens = {token for token in re.split(r"\W+", sentence) if len(token) >= 2}
        if tokens and len(tokens & seen_tokens) / max(1, len(tokens)) > 0.62:
            continue
        selected.append(sentence)
        seen_tokens |= tokens
        if len(selected) >= limit:
            break
    return selected


def _short_label(sentence: str, index: int) -> str:
    label_patterns = [
        (r"(核心|关键|本质)", "核心判断"),
        (r"(步骤|流程|操作|配置)", "操作流程"),
        (r"(风险|问题|错误|避免)", "风险提醒"),
        (r"(例子|案例|比如|例如)", "案例线索"),
        (r"(模型|参数|函数|系统|工具)", "关键机制"),
        (r"(建议|应该|需要|必须)", "行动建议"),
    ]
    for pattern, label in label_patterns:
        if re.search(pattern, sentence):
            return label
    compact = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]+", "", sentence)
    return (compact[:6] or f"要点{index}").strip()


def _read_material(material_path: str) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    with open(os.path.join(material_path, "manifest.json"), "r", encoding="utf-8") as file:
        manifest = json.load(file)

    blocks = []
    blocks_dir = os.path.join(material_path, "blocks")
    for filename in sorted(os.listdir(blocks_dir)):
        if not filename.endswith(".json"):
            continue
        with open(os.path.join(blocks_dir, filename), "r", encoding="utf-8") as file:
            blocks.append(json.load(file))

    raw_path = os.path.join(material_path, "raw_transcript.txt")
    raw_text = ""
    if os.path.exists(raw_path):
        with open(raw_path, "r", encoding="utf-8") as file:
            raw_text = file.read()
    return manifest, blocks, raw_text


def _summary_model_settings() -> dict[str, str]:
    provider = os.getenv("SHIJIE_VIDEO_SUMMARY_PROVIDER", "minimax").strip().lower()
    if provider not in {"minimax", "mimo"}:
        provider = "minimax"
    return {
        "provider": provider,
        "api_key": os.getenv("SHIJIE_VIDEO_SUMMARY_API_KEY", "").strip(),
        "base_url": os.getenv("SHIJIE_VIDEO_SUMMARY_BASE_URL", "https://api.minimaxi.com/v1").strip(),
        "model": os.getenv("SHIJIE_VIDEO_SUMMARY_MODEL", "MiniMax-M2").strip(),
    }


def _resolve_chat_endpoint(settings: dict[str, str]) -> str:
    provider = settings["provider"]
    api_key = settings["api_key"]
    base_url = settings["base_url"].rstrip("/")
    if provider == "mimo":
        if not base_url or "minimaxi.com" in base_url:
            base_url = (
                "https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
                if api_key.startswith("tp-")
                else "https://api.xiaomimimo.com/v1/chat/completions"
            )
        if base_url.endswith("/anthropic"):
            base_url = base_url[: -len("/anthropic")] + "/v1/chat/completions"
    elif not base_url:
        base_url = "https://api.minimaxi.com/v1"
    return base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"


def _build_chat_headers(settings: dict[str, str]) -> dict[str, str]:
    api_key = settings["api_key"]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if settings["provider"] == "mimo":
        headers["api-key"] = api_key
    return headers


def _build_model_source_digest(title: str, source_id: str, blocks: list[dict[str, Any]], raw_text: str) -> str:
    lines = [f"标题：{title}", f"来源：{source_id}", ""]
    raw_text = _filter_transcript_ads(raw_text)
    if raw_text and (len(blocks) <= 2 or len(raw_text) <= 36000):
        lines.extend(["## 完整转写文本", raw_text[:36000], ""])
        return "\n".join(lines).strip()

    for block in blocks[:30]:
        label = "、".join(str(item) for item in (block.get("page_labels") or [])[:2]) or str(block.get("block_id") or "")
        lines.append(f"## {label}")
        points = [str(item).strip() for item in (block.get("key_points") or []) if str(item).strip()]
        if points:
            for point in points[:6]:
                lines.append(f"- {_clean_text(point)}")
        else:
            excerpt = _clean_text(str(block.get("source_excerpt") or ""))
            if excerpt:
                lines.append(excerpt[:1000])
        lines.append("")
    if len(lines) <= 4 and raw_text:
        lines.append(raw_text[:24000])
    return "\n".join(lines).strip()[:42000]


def _clean_model_markdown(markdown: str) -> str:
    text = str(markdown or "").strip()
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"^```(?:markdown|md)?\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s*```$", "", text).strip()
    text = re.sub(r"^##\s*🧭\s*视频主题", "### 💡 视频主题", text, flags=re.MULTILINE)
    text = re.sub(r"^##\s*💡\s*核心内容", "### ✨ 主要内容", text, flags=re.MULTILINE)
    text = re.sub(r"^##\s*💡\s*核心观点", "### ✨ 主要内容", text, flags=re.MULTILINE)
    text = re.sub(r"^##\s*核心观点", "### ✨ 主要内容", text, flags=re.MULTILINE)
    text = re.sub(r"^##\s*核心内容", "### ✨ 主要内容", text, flags=re.MULTILINE)
    text = re.sub(r"^###\s*核心内容", "### ✨ 主要内容", text, flags=re.MULTILINE)
    text = re.sub(r"^###\s*视频主题", "### 💡 视频主题", text, flags=re.MULTILINE)
    return text


def _extract_tags_and_body(summary: str) -> tuple[list[str], str]:
    text = (summary or "").strip()
    if not text:
        return [], ""

    lines = text.splitlines()
    first_nonempty_index = next((index for index, line in enumerate(lines) if line.strip()), None)
    if first_nonempty_index is None:
        return [], ""

    first_line = lines[first_nonempty_index].strip()
    match = re.match(r"^\[TAGS\]\s*(.+)$", first_line, flags=re.IGNORECASE)
    if not match:
        return [], text

    raw_tags = re.split(r"[，,、/\|]+", match.group(1))
    tags: list[str] = []
    for tag in raw_tags:
        clean = tag.strip().strip("#").strip()
        if clean and clean not in tags:
            tags.append(clean)
        if len(tags) >= 2:
            break

    body_lines = lines[:first_nonempty_index] + lines[first_nonempty_index + 1 :]
    body = "\n".join(body_lines).strip()
    return tags, body


def _format_yaml_tag(tag: str) -> str:
    clean = (tag or "").strip()
    if not clean:
        return ""
    if any(char in clean for char in [":", "[", "]", "{", "}", ",", "#", '"', "'"]):
        return json.dumps(clean, ensure_ascii=False)
    return clean


def _request_model_summary(title: str, source_id: str, blocks: list[dict[str, Any]], raw_text: str) -> str:
    settings = _summary_model_settings()
    if not settings["api_key"] or not settings["model"]:
        return ""

    source_digest = _build_model_source_digest(title, source_id, blocks, raw_text)
    if not source_digest:
        return ""

    url = _resolve_chat_endpoint(settings)
    prompt = f"""请只基于以下视频标题、来源和字幕/转写文本，整理一份中文 Markdown 正文。
当前文档的标题和日期会由程序写入。你需要额外给出 2 个简短 tag，但 tag 不能出现在正文段落里，而是单独放在程序可解析的标记行中。
你绝对不要重复输出标题、日期、front matter、引言、问候语或总结段落。

【严格执行规则】
1. 你是一个极度严谨的视频干货提取机，只负责穿透废话，提取视频主体到底讲了什么事实、用了什么论据。
2. 零废话原则：禁止输出“总而言之”“在这个视频中”“视频最后总结道”等包装性废话。
3. 细节至上：禁止抽象化和空泛总结，必须优先保留具体数据、案例、类比、场景、关键数字和有价值的原话。
4. 广告免疫：明显属于广告、赞助、带货、产品植入、购买引导、功能推荐的内容必须静默忽略，绝对不要写“这里忽略了广告”等提示。
5. 不要扩展到评论区、观众反馈、舆情、热度或任何未提供的信息。
6. 如果信息不足，可以明确说“字幕信息有限”或“依据有限字幕判断”，但不要编造细节。
7. 语言风格要客观、冷静、信息密度高，少用形容词，不要重复改写同一个意思。
8. 目标是高密度提炼，不是逐段复述字幕。请优先保留最值得记下来的信息，不要为了完整而把同类内容拆成很多重复要点。
9. 相近观点、重复举例、同一结论的多次铺垫可以合并，但不能把不同主题、步骤、案例、参数、判断依据合并到丢失信息。
10. 输出篇幅要跟随信息密度：普通短视频通常 6-10 条；教程、实操、评测、信息密集视频通常 10-18 条；只有在材料确实很少时才少于 6 条。不要为了简洁强行压缩。
11. 每条要点尽量遵循“观点在前，证据在后”的写法，先说明结论，再补充支撑它的事实、案例、数据或类比。
12. 请根据标题、简介、分区和字幕内容，自行判断它更像评论、教学、新闻、vlog、访谈、评测或其他类型，并据此调整提炼方式；不要被预设模板限制。
13. 每个条目尽量以 `- **短导语：**` 开头，短导语控制在 2-8 个字，让阅读时一眼能扫到重点。
13.1 在每个短导语前加 1 个贴切、克制的 emoji，例如 `- **⚠️ 风险提示：**`、`- **📌 核心结论：**`、`- **🧪 试验数据：**`。emoji 要和内容匹配，不要重复堆砌。
14. 如果内容明显是教程、教学、实操演示，优先整理准备条件、关键步骤、核心方法、常见问题、注意事项和作者建议，不要写成泛泛介绍。
15. 禁止输出 <think>、思考过程、任务复述、制程说明或代码块。

【强制输出结构】
请严格且仅使用以下 Markdown 结构输出：
[TAGS] tag1, tag2
### 💡 视频主题
（用 1-2 句话直接说明这个视频到底在探讨或解决什么问题。）

### ✨ 主要内容
（用条列方式整理视频干货。每条都尽量写成 `- **emoji 短导语：** 具体内容` 的形式。优先输出高密度内容，每一个核心点都必须尽量附带字幕中的事实、例子、数字、类比或原话作为支撑。教程、实操、配置类视频要保留足够步骤和注意事项，不要压缩成少数泛泛观点。）

tag 要求：
1. 只给 2 个 tag。
2. tag 要简短，尽量是 2-6 个字的主题词或领域词，不要写成长句。
3. 不要带井号，不要写解释，不要超过 2 个。
4. 尽量避免空泛口号词，优先使用能概括主题的稳定名词。
5. 除了开头这一行 [TAGS]，不要在正文其他位置重复 tag。

除了这条 [TAGS] 行、两个标题和它们下面的正文，不要输出任何其他章节。

原始材料：
{source_digest}
"""
    response = requests.post(
        url,
        headers=_build_chat_headers(settings),
        json={
            "model": settings["model"],
            "messages": [
                {
                    "role": "system",
                    "content": "你是一个极度严谨的视频干货提取机。你的唯一任务是穿透所有废话、广告、赞助、带货和产品植入，精准提取视频主体到底讲了什么事实、用了什么论据。你极度讨厌空泛总结和套话，只关心具体数据、案例、类比和原话。你只输出可直接保存的中文 Markdown。",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.25,
            "max_tokens": 8192,
        },
        timeout=SUMMARY_MODEL_TIMEOUT,
    )
    if response.status_code >= 400:
        provider_label = "MiMo" if settings["provider"] == "mimo" else "MiniMax"
        raise RuntimeError(f"{provider_label} 视频总结失败：HTTP {response.status_code} {response.text[:300]}")
    payload = response.json()
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "\n".join(str(item.get("text", "")) for item in content if isinstance(item, dict))
    return _clean_model_markdown(str(content or ""))


def _build_summary_markdown(material_path: str, markdown_path: str) -> dict[str, Any]:
    manifest, blocks, raw_text = _read_material(material_path)
    source = manifest.get("source") or {}
    title = str(source.get("title") or os.path.basename(material_path).replace(".course_material", ""))
    source_id = str(source.get("source_id") or "")
    text_source = (manifest.get("acquisition") or {}).get("text_source_type") or ""

    summary_provider = "local"
    model_markdown = ""
    try:
        model_markdown = _request_model_summary(title, source_id, blocks, raw_text)
        if model_markdown:
            summary_provider = _summary_model_settings()["provider"] or "model"
    except Exception as exc:
        print(f"视频总结模型不可用，已回落本地规则摘要：{exc}", flush=True)

    sentences = _split_sentences(raw_text)
    scored = sorted(
        enumerate(sentences),
        key=lambda item: (-_sentence_score(item[1], title), item[0]),
    )
    top_indexes = sorted(index for index, _ in scored[: min(32, len(scored))])
    ordered_candidates = [sentences[index] for index in top_indexes]
    key_points = _dedupe_sentences(ordered_candidates, 8)

    timeline_items = []
    for block in blocks[:12]:
        points = [str(item) for item in (block.get("key_points") or []) if str(item).strip()]
        if not points:
            points = _split_sentences(str(block.get("source_excerpt") or ""))[:2]
        timeline_items.append(
            {
                "label": "、".join(str(label) for label in (block.get("page_labels") or [])[:2]) or str(block.get("block_id")),
                "points": [_clean_text(point) for point in points[:3]],
            }
        )

    fallback_tags = []
    for token in re.split(r"[^\u4e00-\u9fffA-Za-z0-9]+", title):
        token = token.strip()
        if 2 <= len(token) <= 8 and token not in fallback_tags:
            fallback_tags.append(token)
        if len(fallback_tags) >= 2:
            break

    model_tags, model_body = _extract_tags_and_body(model_markdown)
    tags = model_tags or fallback_tags

    frontmatter = [
        "---",
        f"title: {json.dumps(title, ensure_ascii=False)}",
        f"date: {datetime.now().strftime('%Y-%m-%d')}",
        f"source_id: {json.dumps(source_id, ensure_ascii=False)}",
        f"summary_provider: {json.dumps(summary_provider, ensure_ascii=False)}",
        f"tags: [{', '.join(_format_yaml_tag(tag) for tag in tags if _format_yaml_tag(tag))}]" if tags else "tags: []",
        "---",
        "",
    ]

    if model_body:
        lines = frontmatter + [model_body.strip()]
    else:
        lines = [
            *frontmatter,
            "### 💡 视频主题",
            "",
            f"这条内容主要围绕 **{title}** 展开；下面是基于本地字幕/转写文本整理出的高密度摘要。",
            "",
            "### ✨ 主要内容",
            "",
        ]

        if key_points:
            for index, point in enumerate(key_points, start=1):
                lines.append(f"- **{_short_label(point, index)}：** {point}")
        else:
            lines.append("- **摘要不足：** 当前文本过短或噪声过高，暂时只能生成基础来源记录。")

        lines.extend(["", "### 🧭 内容脉络", ""])
        for item in timeline_items:
            lines.append(f"#### {item['label']}")
            if item["points"]:
                for point in item["points"]:
                    lines.append(f"- {point}")
            else:
                lines.append("- 暂无可提取要点。")
            lines.append("")

    body_for_count = "\n".join(lines)
    model_key_point_count = len(re.findall(r"^\s*-\s+\*\*", body_for_count, flags=re.MULTILINE))

    os.makedirs(os.path.dirname(markdown_path), exist_ok=True)
    with open(markdown_path, "w", encoding="utf-8") as file:
        file.write("\n".join(lines).strip() + "\n")

    return {
        "title": title,
        "sourceId": source_id,
        "materialPath": material_path,
        "markdownPath": markdown_path,
        "keyPointCount": model_key_point_count or len(key_points),
        "blockCount": len(blocks),
        "textLength": len(raw_text),
        "summaryProvider": summary_provider,
    }


def summarize_video(video_input: str, output_dir: str, summary_dir: str = "", local_media: bool = False) -> dict[str, Any]:
    material_root = os.path.join(output_dir, "summary_materials")
    summary_root = os.path.abspath(summary_dir) if summary_dir else os.path.join(output_dir, "summaries")
    os.makedirs(material_root, exist_ok=True)
    os.makedirs(summary_root, exist_ok=True)

    previous_output = config.get_output_dir()
    previous_output_env = os.environ.get("SHIJIE_FOCUS_OUTPUT_DIR")
    config.save_runtime_settings(config.SESSDATA, material_root)
    os.environ["SHIJIE_FOCUS_OUTPUT_DIR"] = material_root
    try:
        if local_media:
            material_result = distiller.run_material_package_from_local_media(video_input)
        else:
            material_result = distiller.run_distillation_from_bilibili(video_input, material_only=True)
    finally:
        config.save_runtime_settings(config.SESSDATA, previous_output)
        if previous_output_env is None:
            os.environ.pop("SHIJIE_FOCUS_OUTPUT_DIR", None)
        else:
            os.environ["SHIJIE_FOCUS_OUTPUT_DIR"] = previous_output_env

    material_path = str(material_result.get("materialPath") or "")
    if not material_path or not os.path.isdir(material_path):
        raise RuntimeError("本地素材处理完成，但没有找到可用于总结的原材料包。")

    safe_title = config.sanitize_filename(str(material_result.get("title") or "视频总结"))
    source_id = str(material_result.get("bvid") or "local")
    markdown_path = os.path.join(summary_root, f"{safe_title}_{source_id}.md")
    result = _build_summary_markdown(material_path, markdown_path)
    result["stageTimings"] = material_result.get("stageTimings") or {}
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="视界专注：本地优先视频总结")
    parser.add_argument("video", help="B 站视频链接、BV 号或本地音视频文件路径")
    parser.add_argument("--output-dir", default=config.ensure_output_dir())
    parser.add_argument("--summary-dir", default="")
    parser.add_argument("--local-media", action="store_true")
    parser.add_argument("--result-json", action="store_true")
    args = parser.parse_args()

    try:
        result = summarize_video(args.video, os.path.abspath(args.output_dir), args.summary_dir, local_media=args.local_media)
        if args.result_json:
            print(SUMMARY_RESULT_PREFIX + json.dumps(result, ensure_ascii=False), flush=True)
        else:
            print(result["markdownPath"])
        return 0
    except Exception as exc:
        print(f"视频总结失败：{exc}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
