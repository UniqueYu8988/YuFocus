# -*- coding: utf-8 -*-
"""项目配置。

敏感配置一律通过主进程在启动子进程时注入环境变量。
Python 侧不再从本地 JSON 文件持久化读取 API Key / Cookie。
"""

from __future__ import annotations

import os
import re
import sys


APP_NAME = "视界专注"

custom_home = (
    os.environ.get("SHIJIE_FOCUS_HOME", "").strip()
    or os.environ.get("BILIARCHIVE_HOME", "").strip()
)

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
    os.environ.get("SHIJIE_FOCUS_SETTINGS_PATH", "").strip()
    or os.environ.get("BILIARCHIVE_SETTINGS_PATH", "").strip()
    or os.path.join(PROJECT_ROOT, ".shijie-focus.local.json")
)

OUTPUT_DIR = os.path.abspath(
    os.environ.get("SHIJIE_FOCUS_OUTPUT_DIR", "").strip()
    or os.environ.get("BILIARCHIVE_OUTPUT_DIR", "").strip()
    or DEFAULT_OUTPUT_DIR
)
SESSDATA = os.environ.get("BILIBILI_SESSDATA", "").strip()

TRANSCRIPTION_PROVIDER = (os.environ.get("ONBOARD_TRANSCRIPTION_PROVIDER", "local_sensevoice").strip() or "local_sensevoice").lower()
LOCAL_TRANSCRIPTION_ROOT = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_ROOT", "").strip()
LOCAL_TRANSCRIPTION_PYTHON = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_PYTHON", "").strip()
LOCAL_TRANSCRIPTION_MODEL_ID = (
    os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_MODEL_ID", "iic/SenseVoiceSmall").strip() or "iic/SenseVoiceSmall"
)
LOCAL_TRANSCRIPTION_DEVICE = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_DEVICE", "cuda:0").strip() or "cuda:0"
LOCAL_TRANSCRIPTION_LANGUAGE = os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_LANGUAGE", "zh").strip() or "zh"
LOCAL_TRANSCRIPTION_TIMEOUT = int(os.environ.get("ONBOARD_LOCAL_TRANSCRIPTION_TIMEOUT", "600") or "600")
RESOURCE_MODE = (os.environ.get("ONBOARD_RESOURCE_MODE", "balanced").strip().lower() or "balanced")
if RESOURCE_MODE not in {"fast", "balanced", "background"}:
    RESOURCE_MODE = "balanced"
BACKGROUND_MODE = RESOURCE_MODE == "background" or os.environ.get("ONBOARD_BACKGROUND_MODE", "").strip() == "1"

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
        "transcription_provider": TRANSCRIPTION_PROVIDER,
        "local_transcription_root": LOCAL_TRANSCRIPTION_ROOT,
        "local_transcription_python": LOCAL_TRANSCRIPTION_PYTHON,
        "local_transcription_model_id": LOCAL_TRANSCRIPTION_MODEL_ID,
        "local_transcription_device": LOCAL_TRANSCRIPTION_DEVICE,
        "local_transcription_language": LOCAL_TRANSCRIPTION_LANGUAGE,
        "resource_mode": RESOURCE_MODE,
    }


def apply_process_resource_mode() -> None:
    if not BACKGROUND_MODE:
        return
    try:
        if os.name == "nt":
            import ctypes

            below_normal_priority_class = 0x00004000
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            ctypes.windll.kernel32.SetPriorityClass(handle, below_normal_priority_class)
        else:
            os.nice(10)
    except Exception:
        # Resource throttling should never break course generation.
        return


def save_runtime_settings(
    sessdata: str,
    output_dir: str,
) -> None:
    global SESSDATA, OUTPUT_DIR

    SESSDATA = (sessdata or "").strip()
    OUTPUT_DIR = os.path.abspath((output_dir or DEFAULT_OUTPUT_DIR).strip())
    _sync_headers()


_sync_headers()
apply_process_resource_mode()
