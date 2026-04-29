# -*- coding: utf-8 -*-
"""本地 SenseVoice 音频转写桥接。"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

import config


RESULT_PREFIX = "__ONBOARD_LOCAL_TRANSCRIBE__="
RESULT_ITEM_PREFIX = "__ONBOARD_LOCAL_TRANSCRIBE_ITEM__="


def _resolve_root() -> Path | None:
    raw_root = (config.LOCAL_TRANSCRIPTION_ROOT or "").strip()
    if not raw_root:
        return None
    return Path(raw_root).expanduser().resolve()


def _resolve_python(root: Path) -> Path:
    configured = (config.LOCAL_TRANSCRIPTION_PYTHON or "").strip()
    if configured:
        python_path = Path(configured).expanduser().resolve()
        if python_path.exists():
            return python_path

    candidates = [
        root / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "bin" / "python",
        root / "python.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise RuntimeError(f"未找到本地转写 Python：{root}")


def _resolve_entry(root: Path) -> Path:
    entry = root / "local_audio_distiller.py"
    if not entry.exists():
        raise RuntimeError(f"未找到 local_audio_distiller.py：{entry}")
    return entry


def has_local_engine() -> bool:
    root = _resolve_root()
    if not root or not root.exists():
        return False
    try:
        _resolve_python(root)
        _resolve_entry(root)
    except RuntimeError:
        return False
    return True


def get_model() -> str:
    return config.LOCAL_TRANSCRIPTION_MODEL_ID.strip() or "iic/SenseVoiceSmall"


def get_root_display() -> str:
    root = _resolve_root()
    return str(root) if root else ""


def validate_local_engine() -> tuple[bool, str]:
    root = _resolve_root()
    if not root:
        return False, "未配置本地转写目录。"
    if not root.exists():
        return False, f"本地转写目录不存在：{root}"

    try:
        python_path = _resolve_python(root)
        _resolve_entry(root)
    except RuntimeError as exc:
        return False, str(exc)

    check_code = (
        "import json, sys\n"
        "from pathlib import Path\n"
        "sys.path.insert(0, str(Path(sys.argv[1]).resolve()))\n"
        "import torch\n"
        "payload = {\n"
        "  'cuda_available': bool(torch.cuda.is_available()),\n"
        "  'device_count': int(torch.cuda.device_count()),\n"
        "}\n"
        "if torch.cuda.is_available():\n"
        "  payload['device_name'] = torch.cuda.get_device_name(0)\n"
        f"print('{RESULT_PREFIX}' + json.dumps(payload, ensure_ascii=False))\n"
    )

    try:
        completed = subprocess.run(
            [str(python_path), "-c", check_code, str(root)],
            cwd=str(root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=min(config.LOCAL_TRANSCRIPTION_TIMEOUT, 60),
            env={
                **os.environ,
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
                "PYTHONUNBUFFERED": "1",
            },
        )
    except Exception as exc:
        return False, f"本地引擎检测失败：{exc}"

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        return False, f"本地引擎检测失败：{detail[-1] if detail else '未知错误'}"

    match = re.search(rf"{re.escape(RESULT_PREFIX)}(\{{.*\}})", completed.stdout, re.DOTALL)
    if not match:
        return False, "本地引擎检测失败：未收到可解析结果。"

    payload = json.loads(match.group(1))
    if not payload.get("cuda_available"):
        return False, "本地引擎可启动，但 CUDA 不可用。"

    device_name = str(payload.get("device_name") or "CUDA")
    return True, f"本地 SenseVoice 已就绪 · {device_name}"


def transcribe_audio_file(
    file_path: str,
    *,
    prompt: str = "",
    language: str | None = None,
    timeout: int | None = None,
) -> dict[str, Any]:
    del prompt

    root = _resolve_root()
    if not root:
        raise RuntimeError("未配置本地转写目录，无法启用 SenseVoice。")
    if not root.exists():
        raise RuntimeError(f"本地转写目录不存在：{root}")

    python_path = _resolve_python(root)
    _resolve_entry(root)

    audio_path = Path(file_path).expanduser().resolve()
    if not audio_path.exists():
        raise RuntimeError(f"音频文件不存在：{audio_path}")

    cache_dir = root / "model_cache"
    target_language = (language or config.LOCAL_TRANSCRIPTION_LANGUAGE or "zh").strip() or "zh"
    device = config.LOCAL_TRANSCRIPTION_DEVICE.strip() or "cuda:0"
    model_id = get_model()

    bridge_code = (
        "import json, sys\n"
        "from pathlib import Path\n"
        "root = Path(sys.argv[1]).resolve()\n"
        "audio = Path(sys.argv[2]).resolve()\n"
        "model_id = sys.argv[3]\n"
        "cache_dir = Path(sys.argv[4]).resolve()\n"
        "device = sys.argv[5]\n"
        "language = sys.argv[6]\n"
        "sys.path.insert(0, str(root))\n"
        "from local_audio_distiller import LocalAudioDistiller\n"
        "distiller = LocalAudioDistiller(model_id=model_id, cache_dir=cache_dir, device=device, language=language)\n"
        "text = distiller.transcribe(audio)\n"
        "payload = {'text': text, 'segments': []}\n"
        f"print('{RESULT_PREFIX}' + json.dumps(payload, ensure_ascii=False))\n"
    )

    completed = subprocess.run(
        [
            str(python_path),
            "-c",
            bridge_code,
            str(root),
            str(audio_path),
            model_id,
            str(cache_dir),
            device,
            target_language,
        ],
        cwd=str(root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout or config.LOCAL_TRANSCRIPTION_TIMEOUT,
        env={
            **os.environ,
            "MODELSCOPE_CACHE": str(cache_dir),
            "HF_HOME": str(cache_dir / "hf"),
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
            "PYTHONUNBUFFERED": "1",
        },
    )

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        raise RuntimeError(detail[-1] if detail else "本地音频转写失败。")

    match = re.search(rf"{re.escape(RESULT_PREFIX)}(\{{.*\}})", completed.stdout, re.DOTALL)
    if not match:
        detail = (completed.stdout or completed.stderr or "").strip()
        raise RuntimeError(f"本地音频转写返回结果异常：{detail[:300]}")

    payload = json.loads(match.group(1))
    if not isinstance(payload, dict):
        raise RuntimeError("本地音频转写返回结果异常。")
    return payload


def transcribe_audio_files(
    items: list[dict[str, Any]],
    *,
    prompt: str = "",
    language: str | None = None,
    timeout: int | None = None,
    result_callback: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    del prompt

    root = _resolve_root()
    if not root:
        raise RuntimeError("未配置本地转写目录，无法启用 SenseVoice。")
    if not root.exists():
        raise RuntimeError(f"本地转写目录不存在：{root}")

    python_path = _resolve_python(root)
    _resolve_entry(root)

    normalized_items: list[dict[str, str]] = []
    for index, item in enumerate(items, start=1):
        item_id = str(item.get("id") or f"item_{index:04d}")
        audio_path = Path(str(item.get("file_path") or "")).expanduser().resolve()
        if not audio_path.exists():
            raise RuntimeError(f"音频文件不存在：{audio_path}")
        normalized_items.append({"id": item_id, "file_path": str(audio_path)})

    if not normalized_items:
        return []

    cache_dir = root / "model_cache"
    target_language = (language or config.LOCAL_TRANSCRIPTION_LANGUAGE or "zh").strip() or "zh"
    device = config.LOCAL_TRANSCRIPTION_DEVICE.strip() or "cuda:0"
    model_id = get_model()

    payload = {
        "model_id": model_id,
        "cache_dir": str(cache_dir),
        "device": device,
        "language": target_language,
        "items": normalized_items,
    }

    bridge_code = (
        "import json, sys\n"
        "from pathlib import Path\n"
        "root = Path(sys.argv[1]).resolve()\n"
        "payload_path = Path(sys.argv[2]).resolve()\n"
        "payload = json.loads(payload_path.read_text(encoding='utf-8'))\n"
        "sys.path.insert(0, str(root))\n"
        "from local_audio_distiller import LocalAudioDistiller\n"
        "distiller = LocalAudioDistiller(\n"
        "    model_id=payload['model_id'],\n"
        "    cache_dir=Path(payload['cache_dir']),\n"
        "    device=payload['device'],\n"
        "    language=payload['language'],\n"
        ")\n"
        "results = []\n"
        "for item in payload['items']:\n"
        "    audio = Path(item['file_path']).resolve()\n"
        "    text = distiller.transcribe(audio)\n"
        "    result = {'id': item['id'], 'file_path': str(audio), 'text': text, 'segments': []}\n"
        "    results.append(result)\n"
        f"    print('{RESULT_ITEM_PREFIX}' + json.dumps(result, ensure_ascii=False), flush=True)\n"
        f"print('{RESULT_PREFIX}' + json.dumps({{'results': results}}, ensure_ascii=False), flush=True)\n"
    )

    temp_path = None
    process: subprocess.Popen[str] | None = None
    output_lines: list[str] = []
    results: list[dict[str, Any]] = []
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as temp_file:
            json.dump(payload, temp_file, ensure_ascii=False)
            temp_path = temp_file.name

        process = subprocess.Popen(
            [str(python_path), "-c", bridge_code, str(root), temp_path],
            cwd=str(root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env={
                **os.environ,
                "MODELSCOPE_CACHE": str(cache_dir),
                "HF_HOME": str(cache_dir / "hf"),
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
                "PYTHONUNBUFFERED": "1",
            },
        )
        assert process.stdout is not None
        for line in process.stdout:
            line = line.rstrip("\r\n")
            output_lines.append(line)
            if line.startswith(RESULT_ITEM_PREFIX):
                item_payload = json.loads(line[len(RESULT_ITEM_PREFIX) :])
                if isinstance(item_payload, dict):
                    results.append(item_payload)
                    if result_callback:
                        result_callback(item_payload)
        try:
            return_code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            process.kill()
            raise RuntimeError("本地批量音频转写超时。") from exc
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    if return_code != 0:
        detail = [line for line in output_lines if line.strip()]
        raise RuntimeError(detail[-1] if detail else "本地批量音频转写失败。")

    if not results:
        detail = "\n".join(output_lines).strip()
        raise RuntimeError("本地批量音频转写返回结果异常。")
    return [result for result in results if isinstance(result, dict)]


__all__ = [
    "get_model",
    "get_root_display",
    "has_local_engine",
    "transcribe_audio_files",
    "transcribe_audio_file",
    "validate_local_engine",
]
