# -*- coding: utf-8 -*-
"""项目配置。

敏感配置一律通过主进程在启动子进程时注入环境变量。
Python 侧不再从本地 JSON 文件持久化读取 API Key / Cookie。
"""

from __future__ import annotations

import os
import re
import sys


APP_NAME = "知语狸"

custom_home = os.environ.get("BILIARCHIVE_HOME", "").strip()

if custom_home:
    PROJECT_ROOT = os.path.abspath(custom_home)
elif getattr(sys, "frozen", False):
    executable_dir = os.path.dirname(os.path.abspath(sys.executable))
    parent_dir = os.path.dirname(executable_dir)
    if os.path.basename(executable_dir).lower() == "dist" and os.path.isdir(os.path.join(parent_dir, "src")):
        PROJECT_ROOT = parent_dir
    else:
        PROJECT_ROOT = executable_dir
else:
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
LOCAL_SETTINGS_PATH = os.path.abspath(
    os.environ.get("BILIARCHIVE_SETTINGS_PATH", os.path.join(PROJECT_ROOT, ".biliarchive.local.json"))
)

OUTPUT_DIR = os.path.abspath(os.environ.get("BILIARCHIVE_OUTPUT_DIR", DEFAULT_OUTPUT_DIR).strip() or DEFAULT_OUTPUT_DIR)
SESSDATA = os.environ.get("BILIBILI_SESSDATA", "").strip()

COACH_BASE_URL = os.environ.get("ONBOARD_COACH_BASE_URL", "https://api.minimaxi.com/v1").strip() or "https://api.minimaxi.com/v1"
COACH_API_KEY = os.environ.get("ONBOARD_COACH_API_KEY", "").strip()
COACH_MODEL = os.environ.get("ONBOARD_COACH_MODEL", "MiniMax-M2.7").strip() or "MiniMax-M2.7"

DISTILLER_BASE_URL = os.environ.get("ONBOARD_DISTILLER_BASE_URL", "https://api.minimaxi.com/v1").strip() or "https://api.minimaxi.com/v1"
DISTILLER_API_KEY = os.environ.get("ONBOARD_DISTILLER_API_KEY", "").strip()
DISTILLER_MODEL = os.environ.get("ONBOARD_DISTILLER_MODEL", "MiniMax-M2.7").strip() or "MiniMax-M2.7"

# 兼容仍在引用 MINIMAX_* 的旧代码路径，统一映射到 Distiller 引擎。
MINIMAX_BASE_URL = os.environ.get("MINIMAX_BASE_URL", DISTILLER_BASE_URL).strip() or DISTILLER_BASE_URL
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", DISTILLER_API_KEY).strip() or DISTILLER_API_KEY
MINIMAX_MODEL = os.environ.get("MINIMAX_MODEL", DISTILLER_MODEL).strip() or DISTILLER_MODEL

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1").strip() or "https://api.groq.com/openai/v1"
GROQ_TRANSCRIPTION_MODEL = (
    os.environ.get("GROQ_TRANSCRIPTION_MODEL", "whisper-large-v3-turbo").strip() or "whisper-large-v3-turbo"
)
TRANSCRIPTION_PROVIDER = (os.environ.get("ONBOARD_TRANSCRIPTION_PROVIDER", "groq").strip() or "groq").lower()
LOCAL_TRANSCRIPTION_ROOT = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_ROOT", "").strip()
LOCAL_TRANSCRIPTION_PYTHON = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_PYTHON", "").strip()
LOCAL_TRANSCRIPTION_MODEL_ID = (
    os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_MODEL_ID", "iic/SenseVoiceSmall").strip() or "iic/SenseVoiceSmall"
)
LOCAL_TRANSCRIPTION_DEVICE = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_DEVICE", "cuda:0").strip() or "cuda:0"
LOCAL_TRANSCRIPTION_LANGUAGE = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_LANGUAGE", "zh").strip() or "zh"
LOCAL_TRANSCRIPTION_TIMEOUT = int(os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_TIMEOUT", "600") or "600")

BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com",
}

API_VIDEO_INFO = "https://api.bilibili.com/x/web-interface/view"
API_COMMENTS_MAIN = "https://api.bilibili.com/x/v2/reply/wbi/main"
API_COMMENTS_DETAIL = "https://api.bilibili.com/x/v2/reply/detail"
API_COMMENTS_REPLY = "https://api.bilibili.com/x/v2/reply/reply"
API_COMMENTS_COUNT = "https://api.bilibili.com/x/v2/reply/count"
API_PLAYER = "https://api.bilibili.com/x/player/v2"
API_PLAYER_WBI = "https://api.bilibili.com/x/player/wbi/v2"
API_NAV = "https://api.bilibili.com/x/web-interface/nav"

COMMENT_PAGE_SIZE = 20
REPLY_PAGE_SIZE = 20
REQUEST_DELAY = 0.35


def _sanitize_secret(value: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        return ""
    if "文件名、目录名或卷标语法不正确" in normalized:
        return ""
    if any(ord(char) > 126 or ord(char) < 32 for char in normalized):
        return ""
    return normalized


def build_cookie_header(
    login_mode: str | None = None,
    sessdata: str | None = None,
    cookie: str | None = None,
) -> str:
    _ = login_mode
    _ = cookie
    sessdata_value = _sanitize_secret(SESSDATA if sessdata is None else sessdata)
    return f"SESSDATA={sessdata_value}" if sessdata_value else ""


def _sync_headers() -> None:
    global OUTPUT_DIR
    OUTPUT_DIR = os.path.abspath((OUTPUT_DIR or DEFAULT_OUTPUT_DIR).strip())
    BASE_HEADERS.pop("Cookie", None)
    cookie_header = build_cookie_header()
    if cookie_header:
        BASE_HEADERS["Cookie"] = cookie_header


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = name.strip(" .")
    if len(name) > 80:
        name = name[:80]
    return name


def get_output_dir() -> str:
    return OUTPUT_DIR


def ensure_output_dir() -> str:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return OUTPUT_DIR


def get_runtime_settings() -> dict[str, str]:
    return {
        "sessdata": SESSDATA,
        "output_dir": OUTPUT_DIR,
        "coach_api_base_url": COACH_BASE_URL,
        "coach_api_key": COACH_API_KEY,
        "coach_model": COACH_MODEL,
        "distiller_api_base_url": DISTILLER_BASE_URL,
        "distiller_api_key": DISTILLER_API_KEY,
        "distiller_model": DISTILLER_MODEL,
        "transcription_provider": TRANSCRIPTION_PROVIDER,
        "groq_api_key": GROQ_API_KEY,
        "groq_transcription_model": GROQ_TRANSCRIPTION_MODEL,
        "local_transcription_root": LOCAL_TRANSCRIPTION_ROOT,
        "local_transcription_python": LOCAL_TRANSCRIPTION_PYTHON,
        "local_transcription_model_id": LOCAL_TRANSCRIPTION_MODEL_ID,
        "local_transcription_device": LOCAL_TRANSCRIPTION_DEVICE,
        "local_transcription_language": LOCAL_TRANSCRIPTION_LANGUAGE,
    }


def save_runtime_settings(
    sessdata: str,
    output_dir: str,
    minimax_api_key: str | None = None,
    minimax_model: str | None = None,
    groq_api_key: str | None = None,
    groq_transcription_model: str | None = None,
) -> None:
    global SESSDATA, OUTPUT_DIR, MINIMAX_API_KEY, MINIMAX_MODEL, DISTILLER_API_KEY, DISTILLER_MODEL, GROQ_API_KEY, GROQ_TRANSCRIPTION_MODEL

    SESSDATA = (sessdata or "").strip()
    OUTPUT_DIR = os.path.abspath((output_dir or DEFAULT_OUTPUT_DIR).strip())
    MINIMAX_API_KEY = (MINIMAX_API_KEY if minimax_api_key is None else minimax_api_key.strip())
    MINIMAX_MODEL = (MINIMAX_MODEL if minimax_model is None else (minimax_model.strip() or DISTILLER_MODEL))
    DISTILLER_API_KEY = MINIMAX_API_KEY
    DISTILLER_MODEL = MINIMAX_MODEL
    GROQ_API_KEY = (GROQ_API_KEY if groq_api_key is None else groq_api_key.strip())
    GROQ_TRANSCRIPTION_MODEL = (
        GROQ_TRANSCRIPTION_MODEL
        if groq_transcription_model is None
        else (groq_transcription_model.strip() or "whisper-large-v3-turbo")
    )
    _sync_headers()


def save_minimax_settings(api_key: str, model: str) -> None:
    save_runtime_settings(SESSDATA, OUTPUT_DIR, api_key, model)


def get_minimax_settings() -> tuple[str, str]:
    return MINIMAX_API_KEY, MINIMAX_MODEL


def save_groq_settings(api_key: str, model: str) -> None:
    save_runtime_settings(SESSDATA, OUTPUT_DIR, MINIMAX_API_KEY, MINIMAX_MODEL, api_key, model)


def get_groq_settings() -> tuple[str, str]:
    return GROQ_API_KEY, GROQ_TRANSCRIPTION_MODEL


_sync_headers()
