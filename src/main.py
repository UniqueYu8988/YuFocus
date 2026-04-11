# -*- coding: utf-8 -*-
"""Onboard Anything CLI placeholder entry."""

from __future__ import annotations

import argparse
import json
import os
import sys


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Onboard Anything：交互式伴学系统")
    parser.add_argument("video", nargs="?", help="BV 号或视频链接")
    parser.add_argument("--result-json", action="store_true", help=argparse.SUPPRESS)
    return parser


def emit_progress(message: str, percent: int) -> None:
    print(
        "__BILIARCHIVE_PROGRESS__="
        + json.dumps(
            {
                "message": message,
                "percent": percent,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    print(message, flush=True)


def build_placeholder_result(video_input: str) -> dict[str, object]:
    return {
        "videoTitle": video_input,
        "publishDate": "",
        "outputDir": "",
        "markdownPath": "",
        "fileGenerated": False,
        "hasSubtitles": False,
        "subtitleGroupCount": 0,
        "subtitleEntryCount": 0,
        "textSourceType": "待接入新蒸馏管线",
        "textSourceNote": "",
        "pageCount": 0,
        "pagesWithSubtitles": 0,
        "missingSubtitlePages": [],
        "aiSkippedReason": "旧总结链路已剥离，等待新的 Onboard Distillation Pipeline。",
        "resultNote": "Phase 0 / Phase 1 已完成工程初始化，Phase 2 蒸馏管线尚未接入。",
    }


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.video:
        parser.error("请提供 BV 号或视频链接。")

    emit_progress("Onboard_Anything 已完成工程开辟，等待接入新蒸馏管线。", 100)

    if args.result_json:
        print(
            "__BILIARCHIVE_RESULT__="
            + json.dumps(build_placeholder_result(args.video), ensure_ascii=False)
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
