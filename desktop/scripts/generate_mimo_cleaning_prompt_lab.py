# -*- coding: utf-8 -*-
"""Run MiMo cleaning prompt lab in a temp-only sandbox.

This script compares:
- baseline generic MiMo cleaning prompt
- UP-profiled MiMo cleaning prompt
- optional iteration-2 repair prompt

It only writes under data/temp/mimo-cleaning-prompt-lab and never writes
data/materials. It must not print or persist MiMo API keys.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from time import perf_counter
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

import distiller  # noqa: E402


LAB_ROOT = REPO_ROOT / "data" / "temp" / "mimo-cleaning-prompt-lab"
REPORT_ROOT = LAB_ROOT / "_reports"
REPORT_JSON = REPORT_ROOT / "mimo-cleaning-quality-report.json"
REPORT_MD = REPORT_ROOT / "mimo-cleaning-quality-report.md"

EXPECTED_CREATORS = {
    "橘鸦Juya",
    "技术爬爬虾",
    "罗胖罗振宇",
    "马督工",
    "小黛晨读",
    "杨彧鑫AI",
    "TED官方精选",
}


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_text(path: Path, text: str) -> None:
    _assert_inside_lab(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(text or "").rstrip() + "\n", encoding="utf-8")


def _write_json(path: Path, payload: Any) -> None:
    _assert_inside_lab(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _assert_inside_lab(path: Path) -> None:
    resolved_root = LAB_ROOT.resolve()
    resolved_path = path.resolve()
    if resolved_path != resolved_root and resolved_root not in resolved_path.parents:
        raise RuntimeError(f"拒绝写入临时实验目录之外的路径：{resolved_path}")


def _sha1(text: str) -> str:
    return hashlib.sha1(str(text or "").encode("utf-8")).hexdigest()


def _clip_raw_text(text: str, limit: int) -> str:
    normalized = str(text or "").strip()
    if len(normalized) <= limit:
        return normalized
    # Keep a single coherent front slice so the model sees natural context.
    return normalized[:limit].rstrip()


def _load_desktop_mimo_settings() -> dict[str, str]:
    appdata = os.getenv("APPDATA")
    if not appdata:
        return {}
    candidates = [
        Path(appdata) / "视界专注" / "shijie-focus-secure.json",
        Path(appdata) / "shijie-focus" / "shijie-focus-secure.json",
    ]
    for path in candidates:
        try:
            data = _read_json(path)
        except Exception:
            continue
        runtime_settings = data.get("runtimeSettings") if isinstance(data.get("runtimeSettings"), dict) else {}
        settings = runtime_settings or data
        api_key = str(settings.get("mimo_api_key") or "").strip()
        if not api_key:
            continue
        return {
            "api_key": api_key,
            "endpoint": str(settings.get("mimo_text_endpoint") or "").strip(),
            "model": str(settings.get("mimo_text_model") or "").strip(),
        }
    return {}


def _ensure_mimo_env() -> str:
    if (os.getenv("SHIJIE_MIMO_API_KEY") or "").strip():
        return "env"
    settings = _load_desktop_mimo_settings()
    api_key = settings.get("api_key", "").strip()
    if not api_key:
        return "missing"
    os.environ["SHIJIE_MIMO_API_KEY"] = api_key
    endpoint = settings.get("endpoint", "").strip()
    if endpoint:
        os.environ["SHIJIE_MIMO_CLEANING_ENDPOINT"] = endpoint
        os.environ["SHIJIE_MIMO_ENDPOINT"] = endpoint
    model = settings.get("model", "").strip()
    if model and model != "mimo-v2.5-pro":
        os.environ["SHIJIE_MIMO_CLEANING_MODEL"] = model
        os.environ["SHIJIE_MIMO_MODEL"] = model
    else:
        os.environ["SHIJIE_MIMO_CLEANING_MODEL"] = "mimo-v2.5"
        os.environ["SHIJIE_MIMO_MODEL"] = "mimo-v2.5"
    return "desktop_settings"


def _discover_samples(samples_per_up: int) -> list[dict[str, Any]]:
    materials_root = REPO_ROOT / "data" / "materials"
    grouped: dict[str, list[dict[str, Any]]] = {}
    if not materials_root.exists():
        return []
    for up_dir in materials_root.iterdir():
        if not up_dir.is_dir():
            continue
        for video_dir in up_dir.iterdir():
            if not video_dir.is_dir():
                continue
            manifest_path = video_dir / "manifest.json"
            raw_path = video_dir / "raw_transcript.txt"
            old_clean_path = video_dir / "cleaned_transcript.txt"
            if not manifest_path.exists() or not raw_path.exists():
                continue
            manifest = _read_json(manifest_path)
            source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
            creator = str(source.get("creator") or "").strip()
            title = str(source.get("title") or video_dir.name).strip()
            source_id = str(source.get("source_id") or video_dir.name).strip()
            item = {
                "upId": up_dir.name,
                "videoId": video_dir.name,
                "creator": creator or "未知 UP",
                "title": title,
                "sourceId": source_id,
                "materialDir": str(video_dir),
                "rawPath": str(raw_path),
                "oldCleanPath": str(old_clean_path) if old_clean_path.exists() else "",
                "updatedAt": source.get("ingested_at") or video_dir.stat().st_mtime,
            }
            grouped.setdefault(up_dir.name, []).append(item)
    selected: list[dict[str, Any]] = []
    for items in grouped.values():
        items.sort(key=lambda item: str(item["updatedAt"]), reverse=True)
        selected.extend(items[:samples_per_up])
    selected.sort(key=lambda item: item["creator"])
    return selected


def _make_chunk(raw_text: str) -> distiller.CleaningChunk:
    return distiller.CleaningChunk(
        index=1,
        chunk_id="lab_chunk_001",
        text=raw_text,
        page_labels=["P1"],
        previous_tail="",
        next_head="",
    )


def _cjk_share(text: str) -> float:
    if not text:
        return 0.0
    return len(distiller.CJK_CHAR_PATTERN.findall(text)) / len(text)


def _is_cross_language_cleaning(raw_text: str, cleaned_text: str) -> bool:
    # English ASR/subtitle text faithfully cleaned into Chinese will naturally
    # have a much lower character ratio than Chinese->Chinese cleaning.
    return _cjk_share(raw_text) < 0.12 and _cjk_share(cleaned_text) > 0.45


def _min_reasonable_cleaning_ratio(raw_text: str, cleaned_text: str) -> float:
    return 0.24 if _is_cross_language_cleaning(raw_text, cleaned_text) else 0.72


def _evaluate_quality(raw_text: str, cleaned_text: str, *, creator: str, title: str) -> dict[str, Any]:
    raw_len = len(raw_text)
    cleaned_len = len(cleaned_text)
    ratio = cleaned_len / raw_len if raw_len else 0
    min_ratio = _min_reasonable_cleaning_ratio(raw_text, cleaned_text)
    missing_terms = distiller._missing_critical_numeric_terms(raw_text, cleaned_text)
    unsupported_years = distiller._unsupported_full_year_terms(raw_text, cleaned_text)
    missing_markers = distiller._missing_time_markers(raw_text, cleaned_text)
    source_markers = distiller._extract_time_markers(raw_text)
    profile = distiller._resolve_cleaning_profile(title=title, creator=creator)
    structural_issues = _structural_issues(cleaned_text, profile)
    issues: list[str] = []
    if missing_terms:
        issues.append(f"缺关键数字/日期/术语：{', '.join(missing_terms[:8])}")
    if unsupported_years:
        issues.append(f"疑似新增完整年份：{', '.join(unsupported_years[:8])}")
    if missing_markers:
        issues.append(f"缺时间戳：{', '.join(missing_markers[:8])}")
    if raw_len > 800 and ratio < min_ratio:
        issues.append(f"输出偏短，可能总结化：ratio={ratio:.3f}，min={min_ratio:.2f}")
    if raw_len > 800 and ratio > 1.45:
        issues.append(f"输出偏长，可能扩写：ratio={ratio:.3f}")
    issues.extend(structural_issues)
    return {
        "ok": not issues,
        "ratio": round(ratio, 4),
        "minReasonableRatio": round(min_ratio, 4),
        "crossLanguageCleaning": _is_cross_language_cleaning(raw_text, cleaned_text),
        "rawChars": raw_len,
        "cleanedChars": cleaned_len,
        "criticalTermCount": len(distiller._extract_critical_numeric_terms(raw_text)),
        "missingCriticalTerms": missing_terms,
        "sourceTimeMarkerCount": len(source_markers),
        "missingTimeMarkers": missing_markers,
        "unsupportedFullYears": unsupported_years,
        "structuralIssues": structural_issues,
        "issues": issues,
        "profileId": profile.profile_id if profile else "",
    }


def _structural_issues(cleaned_text: str, profile: distiller.CleaningProfile | None) -> list[str]:
    if not profile:
        return []
    text = cleaned_text.strip()
    issues: list[str] = []
    if profile.profile_id in {"juya_ai_news", "xiaodai_reference_news"}:
        # News-like content should preserve separable items when the output is long enough.
        separators = len(re.findall(r"\n#{1,3}\s+|\n[-*]\s+|\n\d+[.、]\s*", text))
        if len(text) > 800 and separators < 2:
            issues.append("新闻类清稿缺少分条结构")
    if profile.profile_id == "tech_tutorial":
        if not any(word in text for word in ("步骤", "配置", "安装", "点击", "命令", "运行")):
            issues.append("教程类清稿缺少操作结构")
    if profile.profile_id in {"luopang_knowledge", "madugong_public_issue", "yangyuxin_ai_business"}:
        if len(text) > 800 and not any(word in text for word in ("因为", "所以", "但是", "这意味着", "问题", "判断")):
            issues.append("观点类清稿缺少论证连接")
    if profile.profile_id == "ted_speech":
        ted_markers = (
            "故事",
            "实验",
            "研究",
            "发现",
            "观点",
            "启发",
            "问题",
            "起因",
            "原因",
            "机制",
            "想象",
            "这就是",
            "科学家",
            "例子",
            "症状",
        )
        if len(text) > 800 and not any(word in text for word in ted_markers):
            issues.append("演讲类清稿缺少故事或观点线索")
    return issues


def _repair_notes_from_quality(quality: dict[str, Any]) -> list[str]:
    notes: list[str] = []
    missing_terms = quality.get("missingCriticalTerms") or []
    missing_markers = quality.get("missingTimeMarkers") or []
    unsupported_years = quality.get("unsupportedFullYears") or []
    structural_issues = quality.get("structuralIssues") or []
    if missing_terms:
        notes.append(f"上一版缺少或改写关键数字/日期/术语：{', '.join(missing_terms[:12])}")
    if missing_markers:
        notes.append(f"上一版缺少时间戳：{', '.join(missing_markers[:12])}")
    if unsupported_years:
        notes.append(f"上一版疑似新增原文不支持的完整年份：{', '.join(unsupported_years[:12])}")
    if quality.get("ratio", 1) < quality.get("minReasonableRatio", 0.72):
        notes.append("上一版输出偏短，疑似总结化；请保留更多有效信息")
    if quality.get("ratio", 1) > 1.45:
        notes.append("上一版输出偏长，疑似扩写；请只清稿不补充")
    if structural_issues:
        notes.append(f"上一版结构不适配 UP 类型：{'；'.join(structural_issues[:4])}")
    return notes


def _run_mimo_round(
    *,
    chunk: distiller.CleaningChunk,
    title: str,
    profile: distiller.CleaningProfile | None,
    previous_output: str = "",
    repair_notes: list[str] | None = None,
) -> tuple[str, dict[str, Any], float]:
    started = perf_counter()
    text, meta = distiller._request_mimo_cleaning(
        chunk,
        title=title,
        timeout=120,
        cleaning_profile=profile,
        previous_output=previous_output,
        repair_notes=repair_notes,
    )
    elapsed_ms = round((perf_counter() - started) * 1000)
    return text, meta, elapsed_ms


def _dry_run_prompt_payload(chunk: distiller.CleaningChunk, title: str, profile: distiller.CleaningProfile | None) -> dict[str, Any]:
    baseline_messages = distiller._build_cleaning_prompt(chunk, title=title)
    profiled_messages = distiller._build_cleaning_prompt(chunk, title=title, cleaning_profile=profile)
    return {
        "baselinePromptChars": sum(len(message["content"]) for message in baseline_messages),
        "profiledPromptChars": sum(len(message["content"]) for message in profiled_messages),
        "profileId": profile.profile_id if profile else "",
        "profileVersion": distiller.MIMO_CLEANING_PROFILE_VERSION if profile else "",
    }


def _reevaluate_existing_sample(
    sample: dict[str, Any],
    *,
    raw_limit: int,
    auth_source: str,
    existing: dict[str, Any],
) -> dict[str, Any] | None:
    up_id = sample["upId"]
    video_id = sample["videoId"]
    sample_dir = LAB_ROOT / up_id / video_id
    meta_path = sample_dir / "quality.json"
    raw_path = sample_dir / "raw.sample.txt"
    if not raw_path.exists():
        return None

    raw_text = raw_path.read_text(encoding="utf-8")
    if not raw_text:
        raw_text = _clip_raw_text(Path(sample["rawPath"]).read_text(encoding="utf-8"), raw_limit)
        _write_text(raw_path, raw_text)
    old_cleaned_path = sample_dir / "old.cleaned.md"
    old_cleaned = old_cleaned_path.read_text(encoding="utf-8") if old_cleaned_path.exists() else ""
    old_quality = _evaluate_quality(raw_text, old_cleaned, creator=sample["creator"], title=sample["title"]) if old_cleaned else {}

    updated = existing | {
        "authSource": auth_source,
        "rawSha1": _sha1(raw_text),
        "oldQuality": old_quality,
        "cacheHit": True,
    }
    final_quality: dict[str, Any] | None = None
    final_name = ""
    for round_info in updated.get("rounds", []):
        name = round_info.get("name")
        output_path = sample_dir / f"{name}.cleaned.md"
        if not output_path.exists():
            continue
        output_text = output_path.read_text(encoding="utf-8")
        quality = _evaluate_quality(raw_text, output_text, creator=sample["creator"], title=sample["title"])
        round_info["quality"] = quality
        if name == "profiled":
            round_info["status"] = "ok" if quality["ok"] else "needs_repair"
        else:
            round_info["status"] = "ok" if quality["ok"] else "needs_review"
        final_quality = quality
        final_name = str(name or "")

    if final_quality:
        updated["status"] = "ok" if final_quality["ok"] else "needs_review"
        updated["finalRound"] = final_name
        updated["finalQuality"] = final_quality

    _write_json(meta_path, updated)
    return updated


def _run_sample(sample: dict[str, Any], *, force: bool, reevaluate_existing: bool, raw_limit: int, auth_source: str) -> dict[str, Any]:
    up_id = sample["upId"]
    video_id = sample["videoId"]
    sample_dir = LAB_ROOT / up_id / video_id
    meta_path = sample_dir / "quality.json"
    if meta_path.exists() and not force:
        existing = _read_json(meta_path)
        if reevaluate_existing:
            reevaluated = _reevaluate_existing_sample(sample, raw_limit=raw_limit, auth_source=auth_source, existing=existing)
            if reevaluated:
                return reevaluated
        if existing.get("status") in {"ok", "dry_run"} and existing.get("rawSha1"):
            return existing | {"cacheHit": True}

    raw_text = _clip_raw_text(Path(sample["rawPath"]).read_text(encoding="utf-8"), raw_limit)
    old_cleaned = Path(sample["oldCleanPath"]).read_text(encoding="utf-8") if sample.get("oldCleanPath") else ""
    chunk = _make_chunk(raw_text)
    profile = distiller._resolve_cleaning_profile(title=sample["title"], creator=sample["creator"])
    raw_sha1 = _sha1(raw_text)
    old_quality = _evaluate_quality(raw_text, old_cleaned, creator=sample["creator"], title=sample["title"]) if old_cleaned else {}

    result: dict[str, Any] = {
        "schemaVersion": "shijie.mimo-cleaning-prompt-lab.v0.1",
        "status": "pending",
        "authSource": auth_source,
        "upId": up_id,
        "videoId": video_id,
        "creator": sample["creator"],
        "title": sample["title"],
        "sourceId": sample["sourceId"],
        "sourceMaterialDir": str(Path(sample["materialDir"]).relative_to(REPO_ROOT)),
        "sampleDir": str(sample_dir.relative_to(REPO_ROOT)),
        "rawSha1": raw_sha1,
        "oldQuality": old_quality,
        "profile": asdict(profile) if profile else None,
        "rounds": [],
        "cacheHit": False,
    }

    _write_text(sample_dir / "raw.sample.txt", raw_text)
    if old_cleaned:
        _write_text(sample_dir / "old.cleaned.md", old_cleaned)

    if auth_source == "missing":
        prompt_payload = _dry_run_prompt_payload(chunk, sample["title"], profile)
        result.update(
            {
                "status": "dry_run",
                "error": "missing_mimo_api_key",
                "prompt": prompt_payload,
            }
        )
        _write_json(meta_path, result)
        return result

    try:
        baseline_text, baseline_meta, baseline_elapsed = _run_mimo_round(
            chunk=chunk,
            title=sample["title"],
            profile=None,
        )
        baseline_quality = _evaluate_quality(raw_text, baseline_text, creator=sample["creator"], title=sample["title"])
        _write_text(sample_dir / "baseline.cleaned.md", baseline_text)
        result["rounds"].append(
            {
                "name": "baseline",
                "status": "ok" if baseline_quality["ok"] else "needs_review",
                "elapsedMs": baseline_elapsed,
                "provider": {k: v for k, v in baseline_meta.items() if k != "usage"} | {"usage": baseline_meta.get("usage", {})},
                "quality": baseline_quality,
            }
        )

        profiled_text, profiled_meta, profiled_elapsed = _run_mimo_round(
            chunk=chunk,
            title=sample["title"],
            profile=profile,
        )
        profiled_quality = _evaluate_quality(raw_text, profiled_text, creator=sample["creator"], title=sample["title"])
        _write_text(sample_dir / "profiled.cleaned.md", profiled_text)
        result["rounds"].append(
            {
                "name": "profiled",
                "status": "ok" if profiled_quality["ok"] else "needs_repair",
                "elapsedMs": profiled_elapsed,
                "provider": {k: v for k, v in profiled_meta.items() if k != "usage"} | {"usage": profiled_meta.get("usage", {})},
                "quality": profiled_quality,
            }
        )

        final_quality = profiled_quality
        final_name = "profiled"
        repair_notes = _repair_notes_from_quality(profiled_quality)
        if repair_notes:
            repair_text, repair_meta, repair_elapsed = _run_mimo_round(
                chunk=chunk,
                title=sample["title"],
                profile=profile,
                previous_output=profiled_text,
                repair_notes=repair_notes,
            )
            repair_quality = _evaluate_quality(raw_text, repair_text, creator=sample["creator"], title=sample["title"])
            _write_text(sample_dir / "iteration-2.cleaned.md", repair_text)
            result["rounds"].append(
                {
                    "name": "iteration-2",
                    "status": "ok" if repair_quality["ok"] else "needs_review",
                    "elapsedMs": repair_elapsed,
                    "repairNotes": repair_notes,
                    "provider": {k: v for k, v in repair_meta.items() if k != "usage"} | {"usage": repair_meta.get("usage", {})},
                    "quality": repair_quality,
                }
            )
            final_quality = repair_quality
            final_name = "iteration-2"

        result["status"] = "ok" if final_quality["ok"] else "needs_review"
        result["finalRound"] = final_name
        result["finalQuality"] = final_quality
    except Exception as exc:
        result["status"] = "failed"
        result["error"] = str(exc)

    _write_json(meta_path, result)
    return result


def _write_report(items: list[dict[str, Any]], *, auth_source: str) -> dict[str, Any]:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    creators = {item.get("creator") for item in items}
    missing_expected = sorted(EXPECTED_CREATORS - creators)
    summary = {
        "schemaVersion": "shijie.mimo-cleaning-prompt-lab.v0.1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "authSource": auth_source,
        "sampleCount": len(items),
        "okCount": sum(1 for item in items if item.get("status") == "ok"),
        "needsReviewCount": sum(1 for item in items if item.get("status") == "needs_review"),
        "dryRunCount": sum(1 for item in items if item.get("status") == "dry_run"),
        "failedCount": sum(1 for item in items if item.get("status") == "failed"),
        "cacheHitCount": sum(1 for item in items if item.get("cacheHit")),
        "missingExpectedCreators": missing_expected,
    }
    payload = {"summary": summary, "items": items}
    _write_json(REPORT_JSON, payload)

    lines = [
        "# MiMo UP 定制清洗提示词质量报告",
        "",
        f"生成时间：{summary['generatedAt']}",
        f"认证来源：{auth_source if auth_source != 'desktop_settings' else '桌面端设置（未写入报告）'}",
        f"样本数：{summary['sampleCount']}",
        f"通过：{summary['okCount']}",
        f"需复核：{summary['needsReviewCount']}",
        f"Dry-run：{summary['dryRunCount']}",
        f"失败：{summary['failedCount']}",
        "",
        "## 样本结果",
        "",
        "| UP 主 | 视频 | 状态 | 最终轮次 | Profile | 旧稿比例 | 新稿比例 | 主要问题 | 路径 |",
        "|---|---|---|---|---|---:|---:|---|---|",
    ]
    for item in items:
        final_quality = item.get("finalQuality") or {}
        old_quality = item.get("oldQuality") or {}
        issues = "；".join((final_quality.get("issues") or item.get("error") or [])[:3]) if isinstance(final_quality.get("issues"), list) else item.get("error", "")
        profile = item.get("profile") or {}
        lines.append(
            " | ".join(
                [
                    str(item.get("creator", "")),
                    str(item.get("title", "")).replace("|", "/"),
                    str(item.get("status", "")),
                    str(item.get("finalRound", "")),
                    str(profile.get("profile_id", "")),
                    str(old_quality.get("ratio", "")),
                    str(final_quality.get("ratio", "")),
                    str(issues or "无").replace("|", "/"),
                    str(item.get("sampleDir", "")),
                ]
            )
        )
    if missing_expected:
        lines.extend(["", "## 未覆盖的重点 UP", "", *[f"- {name}" for name in missing_expected]])
    _write_text(REPORT_MD, "\n".join(lines))
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="ignore cache and call MiMo again")
    parser.add_argument("--reevaluate-existing", action="store_true", help="reuse existing lab outputs and only refresh quality/report")
    parser.add_argument("--samples-per-up", type=int, default=1)
    parser.add_argument("--raw-limit", type=int, default=3600)
    args = parser.parse_args()

    auth_source = _ensure_mimo_env()
    samples = _discover_samples(max(1, args.samples_per_up))
    results = [
        _run_sample(
            sample,
            force=args.force,
            reevaluate_existing=args.reevaluate_existing,
            raw_limit=max(1200, args.raw_limit),
            auth_source=auth_source,
        )
        for sample in samples
    ]
    report = _write_report(results, auth_source=auth_source)
    print(
        json.dumps(
            {
                "report": {
                    "markdown": str(REPORT_MD.relative_to(REPO_ROOT)),
                    "json": str(REPORT_JSON.relative_to(REPO_ROOT)),
                },
                "summary": report["summary"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
