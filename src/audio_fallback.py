# -*- coding: utf-8 -*-
"""无字幕时的音频下载与 Groq 转写兜底。"""

from __future__ import annotations

from dataclasses import dataclass
import math
import os
import re
import subprocess
import tempfile
from typing import Callable

import imageio_ffmpeg
from yt_dlp import YoutubeDL

import config
import groq_client


FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
TARGET_AUDIO_MAX_BYTES = 24 * 1024 * 1024
TARGET_SAMPLE_RATE = 16000
TARGET_CHANNELS = 1
TARGET_BITRATE = "32k"

ProgressCallback = Callable[[str, int], None]


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


def _normalize_audio(input_path: str, output_path: str) -> str:
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
            "-c:a",
            "aac",
            "-b:a",
            TARGET_BITRATE,
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
) -> list[dict]:
    if os.path.getsize(input_path) <= TARGET_AUDIO_MAX_BYTES:
        return [{"path": input_path, "offset": start_offset}]

    duration = _probe_duration_seconds(input_path)
    chunk_count = max(2, math.ceil(os.path.getsize(input_path) / TARGET_AUDIO_MAX_BYTES))
    chunk_duration = max(60.0, duration / chunk_count)

    chunks: list[dict] = []
    current = 0.0
    index = 1
    while current < duration - 0.5:
        remaining = duration - current
        segment_duration = min(chunk_duration, remaining)
        chunk_path = os.path.join(chunks_dir, f"chunk_{depth}_{index:02d}.m4a")
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
                "-c:a",
                "aac",
                "-b:a",
                TARGET_BITRATE,
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
                )
            )
        else:
            chunks.append({"path": chunk_path, "offset": start_offset + current})
        current += segment_duration
        index += 1

    return chunks


def _payload_to_entries(payload: dict, offset: float) -> list[dict]:
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
        return [{"from": offset, "to": offset, "content": text}]
    return []


def transcribe_video_pages(
    video_info: dict,
    pages: list[dict],
    progress_callback: ProgressCallback | None = None,
) -> TranscriptionBundle:
    if not pages:
        return TranscriptionBundle([], 0, [], 0, "未启用音频转写", "groq_whisper", "没有需要转写的分P。", groq_client.get_model())
    if not groq_client.has_api_key():
        raise RuntimeError("未配置 Groq API Key，无法启用音频转写方案。")

    language = _guess_language(video_info)
    transcribed_segments: list[dict] = []
    pages_without_text: list[str] = []
    total_entries = 0

    with tempfile.TemporaryDirectory(prefix="zhiyuli-audio-") as temp_dir:
        for index, page in enumerate(pages, start=1):
            page_no = int(page.get("page") or index)
            page_part = str(page.get("part") or "").strip() or f"P{page_no}"
            page_label = str(page.get("label") or f"P{page_no}：{page_part}")
            file_stem = _sanitize_stem(f"{video_info['bvid']}_p{page_no}")
            page_dir = os.path.join(temp_dir, f"page_{page_no:02d}")
            os.makedirs(page_dir, exist_ok=True)

            try:
                _emit(progress_callback, f"方案2：正在下载 {page_label} 的音频（{index}/{len(pages)}）...", 54)
                source_path = _download_audio(_build_page_url(video_info, page_no), page_dir, file_stem)

                normalized_path = os.path.join(page_dir, f"{file_stem}_16k.m4a")
                _emit(progress_callback, f"方案2：正在压缩 {page_label} 的音频...", 62)
                _normalize_audio(source_path, normalized_path)

                chunk_dir = os.path.join(page_dir, "chunks")
                os.makedirs(chunk_dir, exist_ok=True)
                chunks = _split_audio_if_needed(normalized_path, chunk_dir)
                _emit(progress_callback, f"方案2：正在提交 {page_label} 到 Groq 转写（共 {len(chunks)} 段）...", 72)

                entries: list[dict] = []
                prompt = _build_transcription_prompt(video_info, page_label)
                for chunk_index, chunk in enumerate(chunks, start=1):
                    _emit(
                        progress_callback,
                        f"方案2：Groq 正在转写 {page_label} 第 {chunk_index}/{len(chunks)} 段...",
                        78,
                    )
                    payload = groq_client.transcribe_audio_file(
                        chunk["path"],
                        prompt=prompt,
                        language=language,
                    )
                    entries.extend(_payload_to_entries(payload, float(chunk["offset"])))

                entries = [entry for entry in entries if str(entry.get("content", "")).strip()]
                if not entries:
                    pages_without_text.append(page_label)
                    _emit(progress_callback, f"方案2：{page_label} 未转写出有效文本，已跳过。", 80)
                    continue

                total_entries += len(entries)
                transcribed_segments.append(
                    {
                        "page": page_no,
                        "label": page_label,
                        "entries": entries,
                    }
                )
                _emit(progress_callback, f"方案2：{page_label} 转写完成，共 {len(entries)} 条文本。", 82)
            except Exception as exc:
                pages_without_text.append(page_label)
                _emit(progress_callback, f"方案2：{page_label} 转写失败：{exc}", 82)

    subtitles: list[dict] = []
    if transcribed_segments:
        transcribed_segments.sort(key=lambda item: int(item.get("page") or 0))
        subtitles = [
            {
                "lang": "音频转写",
                "lan": "zh-groq-transcript",
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
        f"已使用 {groq_client.get_model()} 转写 {len(transcribed_segments)}/{len(pages)} 个分P，"
        f"共得到 {total_entries} 条文本。"
    )
    if pages_without_text:
        note += f" 未成功转写：{'；'.join(pages_without_text)}。"

    return TranscriptionBundle(
        subtitles=subtitles,
        pages_transcribed=len(transcribed_segments),
        pages_without_text=pages_without_text,
        entry_count=total_entries,
        source_type="Groq 音频转写",
        source_api="groq_whisper",
        note=note,
        model=groq_client.get_model(),
    )
