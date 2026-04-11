# -*- coding: utf-8 -*-
"""Groq Whisper 转写客户端。"""

from __future__ import annotations

import os
from typing import Any

import requests

import config


DEFAULT_TIMEOUT = 300


def has_api_key() -> bool:
    return bool(config.GROQ_API_KEY.strip())


def get_model() -> str:
    return config.GROQ_TRANSCRIPTION_MODEL.strip() or "whisper-large-v3-turbo"


def validate_api_key(api_key: str, model: str) -> tuple[bool, str]:
    api_key = (api_key or "").strip()
    model = (model or "whisper-large-v3-turbo").strip()
    if not api_key:
        return True, "未填写 Groq API Key，无字幕时将无法启用音频转写方案。"

    url = config.GROQ_BASE_URL.rstrip("/") + "/models"
    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    try:
        response = requests.get(url, headers=headers, timeout=30)
        if response.status_code == 401:
            return False, "Groq API Key 无效，返回 401。"
        if response.status_code == 403:
            return False, "Groq API Key 无权限，返回 403。"
        if response.status_code >= 400:
            return False, f"Groq 检测失败：HTTP {response.status_code}"

        payload = response.json()
        models = payload.get("data") or []
        model_ids = {str(item.get("id", "")) for item in models if isinstance(item, dict)}
        if model_ids and model not in model_ids:
            return False, f"Groq Key 可用，但未找到模型：{model}"
        return True, f"Groq API Key 有效，模型：{model}"
    except Exception as exc:
        return False, f"Groq 检测失败：{exc}"


def transcribe_audio_file(
    file_path: str,
    *,
    prompt: str = "",
    language: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    if not has_api_key():
        raise RuntimeError("未配置 Groq API Key。")

    url = config.GROQ_BASE_URL.rstrip("/") + "/audio/transcriptions"
    headers = {
        "Authorization": f"Bearer {config.GROQ_API_KEY.strip()}",
    }
    data: dict[str, str] = {
        "model": get_model(),
        "response_format": "verbose_json",
        "temperature": "0",
    }
    if prompt.strip():
        data["prompt"] = prompt.strip()
    if language:
        data["language"] = language

    with open(file_path, "rb") as audio_file:
        files = {
            "file": (
                os.path.basename(file_path),
                audio_file,
                "application/octet-stream",
            )
        }
        response = requests.post(url, headers=headers, data=data, files=files, timeout=timeout)

    if response.status_code == 401:
        raise RuntimeError("Groq API Key 无效，返回 401。")
    if response.status_code == 403:
        raise RuntimeError("Groq API Key 无权限，返回 403。")
    if response.status_code >= 400:
        try:
            payload = response.json()
            message = payload.get("error", {}).get("message") or payload.get("message")
        except Exception:
            message = response.text[:300]
        raise RuntimeError(f"Groq 转写失败：{message or ('HTTP ' + str(response.status_code))}")

    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Groq 转写返回结果异常。")
    return payload
