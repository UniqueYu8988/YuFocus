# -*- coding: utf-8 -*-
"""Golden and synthetic checks for the learning-notes material pipeline.

This script exercises the protocol layer without running a real video import or
asking Codex to write content. It generates a large synthetic .course_material
package, creates a few ready/not-ready cases, and checks that the deterministic
gates catch fake completion patterns.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import shutil
from typing import Any

import config
from distiller import ChunkPlan, SourceDescriptor, TextChunk, TextUnit, save_codex_material_package


DEFAULT_OUTPUT_DIR = Path(config.DEFAULT_OUTPUT_DIR) / "evals" / "synthetic_300k"


@dataclass(frozen=True)
class CaseSpec:
    name: str
    expected_pipeline_ready: bool
    expected_audit_ready: bool
    notes_mode: str
    trace_mode: str
    audit_result: str
    evidence_mode: str


def _ensure_inside_output(path: Path) -> Path:
    resolved = path.resolve()
    output_root = Path(config.DEFAULT_OUTPUT_DIR).resolve()
    if resolved != output_root and output_root not in resolved.parents:
        raise RuntimeError(f"Refusing to write outside output/: {resolved}")
    return resolved


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _plain_length(markdown: str) -> int:
    text = re.sub(r"```[\s\S]*?```", " ", markdown)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[[^\]]+\]\([^)]+\)", " ", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[|*_>#-]", " ", text)
    return len(re.sub(r"\s+", "", text))


def _heading_body_lengths(markdown: str, level: int) -> list[int]:
    pattern = re.compile(rf"^#{{{level}}}\s+(.+?)\s*#*\s*$", re.MULTILINE)
    matches = list(pattern.finditer(markdown))
    lengths: list[int] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        lengths.append(_plain_length(markdown[match.start():end]))
    return [item for item in lengths if item > 0]


def _markdown_headings(markdown: str) -> list[tuple[int, str]]:
    return [
        (len(match.group(1)), match.group(2).strip())
        for match in re.finditer(r"^(#{1,6})\s+(.+?)\s*#*\s*$", markdown, flags=re.MULTILINE)
    ]


def _normalize_heading(value: str) -> str:
    return re.sub(r"\s+", "", re.sub(r"^#{1,6}\s+", "", value.strip())).lower()


def _median(values: list[int]) -> int:
    if not values:
        return 0
    sorted_values = sorted(values)
    middle = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[middle]
    return round((sorted_values[middle - 1] + sorted_values[middle]) / 2)


def _read_source_index(path: Path) -> tuple[set[str], set[str], int]:
    entry_ids: set[str] = set()
    block_ids: set[str] = set()
    invalid_lines = 0
    if not path.exists():
        return entry_ids, block_ids, invalid_lines
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except Exception:
            invalid_lines += 1
            continue
        entry_id = str(payload.get("entry_id") or "").strip()
        block_id = str(payload.get("block_id") or "").strip()
        if entry_id:
            entry_ids.add(entry_id)
        if block_id:
            block_ids.add(block_id)
    return entry_ids, block_ids, invalid_lines


def _read_trace_links(path: Path) -> list[dict[str, Any]]:
    payload = _read_json(path)
    links = payload.get("links")
    return [item for item in links if isinstance(item, dict)] if isinstance(links, list) else []


def _read_jsonl_records(path: Path) -> tuple[list[dict[str, Any]], int]:
    records: list[dict[str, Any]] = []
    invalid_lines = 0
    if not path.exists():
        return records, invalid_lines
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except Exception:
            invalid_lines += 1
            continue
        if isinstance(payload, dict):
            records.append(payload)
        else:
            invalid_lines += 1
    return records, invalid_lines


def _structured_records_from_dir(path: Path) -> tuple[list[dict[str, Any]], int]:
    records: list[dict[str, Any]] = []
    invalid_count = 0
    if not path.exists():
        return records, invalid_count
    for file_path in path.rglob("*"):
        if not file_path.is_file() or file_path.suffix.lower() not in {".json", ".jsonl"}:
            continue
        if file_path.suffix.lower() == ".jsonl":
            parsed, invalid_lines = _read_jsonl_records(file_path)
            records.extend(parsed)
            invalid_count += invalid_lines
            continue
        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:
            invalid_count += 1
            continue
        if isinstance(payload, list):
            records.extend(item for item in payload if isinstance(item, dict))
        elif isinstance(payload, dict):
            for key in ("pages", "learning_pages", "learning_units", "sections", "units", "cards", "source_cards", "claims"):
                value = payload.get(key)
                if isinstance(value, list):
                    records.extend(item for item in value if isinstance(item, dict))
                    break
            else:
                records.append(payload)
    return records, invalid_count


def _list_strings(value: Any) -> list[str]:
    return [str(item).strip() for item in value] if isinstance(value, list) else []


def _first_text(payload: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    return ""


def _target_heading(payload: dict[str, Any]) -> str:
    return _first_text(payload, ("target_heading", "heading", "title", "target_title"))


def _audit_result(path: Path) -> str:
    if not path.exists():
        return "missing"
    content = path.read_text(encoding="utf-8")
    match = re.search(r"^\s*audit_result\s*:\s*(pass|needs_fix|blocked|unknown)\s*$", content, re.IGNORECASE | re.MULTILINE)
    if match:
        return match.group(1).lower()
    return "unknown"


def _validate_strict_evidence(
    material_path: Path,
    *,
    learning_unit_count: int,
    learning_unit_headings: list[str],
    required_topic_count: int,
    source_entry_ids: set[str],
    source_block_ids: set[str],
    error,
) -> None:
    contract = _read_json(material_path / "validation_contract.json")
    capabilities = contract.get("capabilities") if isinstance(contract.get("capabilities"), dict) else {}
    if not any(value == "required" for value in capabilities.values()):
        return

    plan_records, plan_invalid = _structured_records_from_dir(material_path / "content_draft" / "work" / "learning_page_plans")
    candidate_records, candidate_invalid = _structured_records_from_dir(material_path / "content_draft" / "work" / "source_cards" / "candidates")
    required_records, required_invalid = _structured_records_from_dir(material_path / "content_draft" / "work" / "source_cards" / "required")
    claim_records, claim_invalid = _structured_records_from_dir(material_path / "content_draft" / "work" / "published_claims")
    heading_set = {_normalize_heading(heading) for heading in learning_unit_headings if _normalize_heading(heading)}

    if capabilities.get("learning_page_plan") == "required":
        if plan_invalid:
            error("learning_page_plan_invalid", "learning page plan has invalid JSON/JSONL")
        if len(plan_records) < learning_unit_count:
            error("learning_page_plan_incomplete", f"plan records {len(plan_records)} < learning units {learning_unit_count}")
    plan_heading_set: set[str] = set()
    plan_cards_by_heading: dict[str, set[str]] = {}
    for record in plan_records:
        heading = _target_heading(record)
        normalized = _normalize_heading(heading) if heading else ""
        if not normalized:
            error("learning_page_plan_missing_target_heading", "learning page plan missing target heading")
        else:
            plan_heading_set.add(normalized)
            if heading_set and normalized not in heading_set:
                error("learning_page_plan_unknown_target_heading", heading)
        refs = _list_strings(record.get("required_source_card_ids") or record.get("source_card_ids") or record.get("card_ids"))
        plan_cards_by_heading.setdefault(normalized, set()).update(refs)
        if not refs:
            error("learning_page_plan_missing_source_cards", "learning page plan missing source cards")
    for heading in heading_set:
        if heading not in plan_heading_set:
            error("learning_page_plan_missing_for_units", heading)

    if capabilities.get("candidate_source_cards") == "required":
        if candidate_invalid:
            error("candidate_source_cards_invalid", "candidate source cards have invalid JSON/JSONL")
        if not candidate_records:
            error("candidate_source_cards_empty", "candidate source cards are empty")
    if capabilities.get("required_source_cards") == "required":
        if required_invalid:
            error("required_source_cards_invalid", "required source cards have invalid JSON/JSONL")
        if not required_records:
            error("required_source_cards_empty", "required source cards are empty")

    required_card_ids: set[str] = set()
    candidate_card_ids = {_first_text(record, ("card_id", "source_card_id", "id")) for record in candidate_records}
    candidate_card_ids.discard("")
    for record in required_records:
        card_id = _first_text(record, ("card_id", "source_card_id", "id"))
        if not card_id:
            error("required_source_cards_missing_id", "required source card missing id")
        else:
            required_card_ids.add(card_id)
        candidate_id = _first_text(record, ("candidate_card_id", "candidate_id"))
        if candidate_id and candidate_card_ids and candidate_id not in candidate_card_ids:
            error("required_source_cards_unknown_candidates", candidate_id)
        entry_ids = _list_strings(record.get("source_index_entry_ids") or record.get("source_entry_ids"))
        block_ids = _list_strings(record.get("block_ids") or record.get("blocks"))
        if not entry_ids and not block_ids:
            error("required_source_cards_missing_source_refs", "required source card missing source refs")
        if not _first_text(record, ("excerpt", "source_excerpt", "quote", "text")) and not _first_text(record, ("lock_snapshot_hash", "source_snapshot_hash")):
            error("required_source_cards_missing_snapshot", "required source card missing excerpt or lock hash")
        unknown_entries = [entry_id for entry_id in entry_ids if source_entry_ids and entry_id not in source_entry_ids]
        unknown_blocks = [block_id for block_id in block_ids if source_block_ids and block_id not in source_block_ids]
        if unknown_entries:
            error("required_source_cards_unknown_source_entries", ", ".join(unknown_entries[:8]))
        if unknown_blocks:
            error("required_source_cards_unknown_blocks", ", ".join(unknown_blocks[:8]))

    if capabilities.get("published_claims") == "required":
        if claim_invalid:
            error("published_claims_invalid", "published claims have invalid JSON/JSONL")
        minimum_claims = max(learning_unit_count, min(required_topic_count, learning_unit_count * 3))
        if len(claim_records) < minimum_claims:
            error("published_claims_too_few", f"claims {len(claim_records)} < {minimum_claims}")
    claim_heading_set: set[str] = set()
    for record in claim_records:
        if not _first_text(record, ("claim", "text", "statement")):
            error("published_claims_missing_text", "published claim missing text")
        heading = _target_heading(record)
        normalized = _normalize_heading(heading) if heading else ""
        if not normalized:
            error("published_claims_missing_target_heading", "published claim missing target heading")
        else:
            claim_heading_set.add(normalized)
            if heading_set and normalized not in heading_set:
                error("published_claims_unknown_target_heading", heading)
        refs = _list_strings(record.get("required_source_card_ids") or record.get("source_card_ids") or record.get("card_ids"))
        if not refs:
            error("published_claims_missing_source_cards", "published claim missing source card refs")
        unknown_refs = [card_id for card_id in refs if required_card_ids and card_id not in required_card_ids]
        if unknown_refs:
            error("published_claims_unknown_source_cards", ", ".join(unknown_refs[:8]))
        unplanned_refs = [card_id for card_id in refs if normalized in plan_cards_by_heading and plan_cards_by_heading[normalized] and card_id not in plan_cards_by_heading[normalized]]
        if unplanned_refs:
            error("published_claims_cards_not_in_page_plan", ", ".join(unplanned_refs[:8]))
    for heading in heading_set:
        if heading not in claim_heading_set:
            error("published_claims_missing_for_units", heading)


def _evaluate_package(material_path: Path) -> dict[str, Any]:
    manifest = _read_json(material_path / "manifest.json")
    run_state = _read_json(material_path / "run_state.json")
    stage = str(run_state.get("stage") or run_state.get("current_stage") or "")
    block_count = int(manifest.get("block_count") or 0)
    raw_length = int(manifest.get("raw_transcript_length") or manifest.get("text_length") or 0)
    long_material = raw_length > 100_000 or block_count > 8

    issues: list[dict[str, str]] = []

    def error(code: str, message: str) -> None:
        issues.append({"severity": "error", "code": code, "message": message})

    learning_notes_path = material_path / "content_draft" / "learning_notes.md"
    mindmap_path = material_path / "content_draft" / "chapter_mindmap.md"
    source_index_path = material_path / "indexes" / "source_index.jsonl"
    notes_trace_path = material_path / "indexes" / "learning_notes_trace.json"
    mindmap_trace_path = material_path / "indexes" / "chapter_mindmap_trace.json"
    audit_path = material_path / "content_draft" / "review_exports" / "quality_audit_report.md"

    if stage == "learning_notes_ready":
        for relative_path in [
            "content_draft/work/knowledge_tree.json",
            "content_draft/work/coverage_matrix.json",
            "content_draft/work/block_reread_ledger.jsonl",
            "content_draft/work/self_check.md",
        ]:
            if not (material_path / relative_path).exists():
                error("required_artifact_missing", f"{relative_path} is missing")

    if not learning_notes_path.exists():
        error("learning_notes_missing", "learning_notes.md is missing")
        notes = ""
        learning_unit_headings: list[str] = []
    else:
        notes = learning_notes_path.read_text(encoding="utf-8")
        plain = _plain_length(notes)
        h1_count = len(re.findall(r"^#\s+", notes, flags=re.MULTILINE))
        h3_lengths = _heading_body_lengths(notes, 3)
        h2_count = len(re.findall(r"^##\s+", notes, flags=re.MULTILINE))
        h3_count = len(h3_lengths)
        learning_unit_count = h3_count if h3_count else h2_count
        headings = _markdown_headings(notes)
        learning_unit_level = 3 if h3_count else 2
        learning_unit_headings = [title for level, title in headings if level == learning_unit_level]
        median_h3 = _median(h3_lengths)
        if h1_count != 1:
            error("learning_notes_h1_invalid", f"expected one h1, got {h1_count}")
        if long_material:
            minimum = max(24_000, min(round(raw_length * 0.08), 60_000))
            if plain < minimum:
                error("learning_notes_too_thin_for_long_material", f"plain length {plain} < {minimum}")
            if len(h3_lengths) >= 8 and median_h3 < 650:
                error("learning_units_too_short", f"median h3 length {median_h3} < 650")
        if re.search(r"source_refs?|block_\d{3,}|raw offset|raw_offset|debug", notes, flags=re.IGNORECASE):
            error("learning_notes_has_debug_refs", "learning notes expose backend refs")

    if not mindmap_path.exists() or len(mindmap_path.read_text(encoding="utf-8").strip()) < 240:
        error("chapter_mindmap_missing_or_short", "chapter_mindmap.md is missing or too short")

    source_entry_ids, source_block_ids, invalid_source_lines = _read_source_index(source_index_path)
    if not source_index_path.exists():
        error("source_index_missing", "source_index.jsonl is missing")
    if invalid_source_lines:
        error("source_index_invalid_jsonl", f"{invalid_source_lines} source_index lines failed JSON parse")
    if block_count and len(source_block_ids) < block_count:
        error("source_index_incomplete", f"source_index block ids {len(source_block_ids)} < block_count {block_count}")

    for trace_name, trace_path in [
        ("learning_notes_trace", notes_trace_path),
        ("chapter_mindmap_trace", mindmap_trace_path),
    ]:
        links = _read_trace_links(trace_path)
        if long_material and not trace_path.exists():
            error(f"{trace_name}_missing", f"{trace_path.name} is missing")
        elif long_material and not links:
            error(f"{trace_name}_empty", f"{trace_path.name} has no links")
        missing_blocks = {
            str(block_id)
            for link in links
            for block_id in (link.get("block_ids") if isinstance(link.get("block_ids"), list) else [])
            if str(block_id) not in source_block_ids
        }
        if missing_blocks:
            error(f"{trace_name}_points_to_unknown_blocks", ", ".join(sorted(missing_blocks)[:8]))

    if stage == "learning_notes_ready":
        h3_count = len(_heading_body_lengths(notes, 3)) if notes else 0
        h2_count = len(re.findall(r"^##\s+", notes, flags=re.MULTILINE)) if notes else 0
        learning_unit_count = h3_count if h3_count else h2_count
        required_topic_count = 0
        coverage = _read_json(material_path / "content_draft" / "work" / "coverage_matrix.json")
        topics = coverage.get("topics") if isinstance(coverage.get("topics"), list) else []
        required_topic_count = len([item for item in topics if isinstance(item, dict)])
        _validate_strict_evidence(
            material_path,
            learning_unit_count=learning_unit_count,
            learning_unit_headings=learning_unit_headings,
            required_topic_count=required_topic_count,
            source_entry_ids=source_entry_ids,
            source_block_ids=source_block_ids,
            error=error,
        )

    pipeline_ready = stage == "learning_notes_ready" and learning_notes_path.exists() and mindmap_path.exists() and not issues
    audit_status = _audit_result(audit_path)
    audit_ready = pipeline_ready and audit_status == "pass"
    return {
        "stage": stage,
        "raw_length": raw_length,
        "block_count": block_count,
        "pipeline_ready": pipeline_ready,
        "audit_ready": audit_ready,
        "audit_result": audit_status,
        "issue_codes": [item["code"] for item in issues],
        "issues": issues,
    }


def _repeat_to_length(seed: str, target_chars: int) -> str:
    repeats = math.ceil(target_chars / max(1, len(seed)))
    return (seed * repeats)[:target_chars]


def _synthetic_chunk_text(index: int, target_chars: int) -> str:
    seed = (
        f"Synthetic branch {index:02d}. This material describes a learning concept, "
        "its mechanism, boundary, example, misconception, and review hook. "
        "The text is intentionally repetitive but structured enough to exercise "
        "chunking, source indexing, trace maps, validator gates, and audit gates. "
    )
    return _repeat_to_length(seed, target_chars)


def _generate_base_material(output_dir: Path, target_chars: int) -> Path:
    chunk_target = 18_000
    chunk_count = max(1, math.ceil(target_chars / chunk_target))
    chunks: list[TextChunk] = []
    units: list[TextUnit] = []
    subtitles: list[dict[str, Any]] = [{"lan": "zh-CN", "lang": "zh-CN", "page_segments": []}]
    remaining = target_chars
    for index in range(1, chunk_count + 1):
        chunk_chars = min(chunk_target, remaining)
        remaining -= chunk_chars
        label = f"P{index}: Synthetic learning branch {index:02d}"
        text = _synthetic_chunk_text(index, chunk_chars)
        start = float((index - 1) * 60)
        end = float(index * 60)
        unit = TextUnit(page_label=label, text=text, estimated_tokens=math.ceil(len(text) / 1.7), start_time=start, end_time=end)
        chunk = TextChunk(
            index=index,
            chunk_id=f"chunk_{index:03d}",
            text=text,
            units=[unit],
            estimated_tokens=unit.estimated_tokens,
            page_labels=[label],
            start_time=start,
            end_time=end,
        )
        units.append(unit)
        chunks.append(chunk)
        subtitles[0]["page_segments"].append(
            {
                "page": index,
                "label": label,
                "entries": [
                    {"from": start, "to": (start + end) / 2, "content": text[: len(text) // 2]},
                    {"from": (start + end) / 2, "to": end, "content": text[len(text) // 2:]},
                ],
            }
        )

    return Path(
        save_codex_material_package(
            video_info={"bvid": "SYNTH300K001", "title": "Synthetic 300k Learning Notes Eval"},
            subtitles=subtitles,
            plan=ChunkPlan(units=units, chunks=chunks, text_length=sum(len(chunk.text) for chunk in chunks)),
            source=SourceDescriptor(
                source_type="synthetic",
                source_id="SYNTH300K001",
                title="Synthetic 300k Learning Notes Eval",
                language="zh-CN",
            ),
            output_dir=str(output_dir),
            text_source_type="synthetic_transcript",
            text_source_note="synthetic eval transcript",
            ingested_at=datetime.now(timezone.utc).isoformat(),
        )
    )


def _source_block_ids(material_path: Path) -> list[str]:
    _, block_ids, _ = _read_source_index(material_path / "indexes" / "source_index.jsonl")
    return sorted(block_ids)


def _make_learning_notes(mode: str, block_ids: list[str]) -> str:
    if mode == "thin":
        section_chars = 260
    else:
        section_chars = 2_500
    sections: list[str] = ["# Synthetic 300k Learning Notes Eval", ""]
    for chapter_index in range(1, 5):
        sections.extend([f"## Chapter {chapter_index}: Synthetic Learning Route", ""])
        for section_index in range(1, 4):
            global_index = (chapter_index - 1) * 3 + section_index
            seed = (
                f"### {chapter_index}.{section_index} Complete learning unit {global_index}\n\n"
                "This unit states the learning problem, explains the mechanism, gives a concrete example, "
                "marks the boundary against a nearby idea, and leaves a review hook for later reading. "
                "It is synthetic text for protocol testing, not product content. "
            )
            sections.append(_repeat_to_length(seed, section_chars))
            sections.append("")
    return "\n".join(sections)


def _make_mindmap() -> str:
    return "\n".join(
        [
            "# Chapter Mindmap",
            "",
            "```mermaid",
            "flowchart TD",
            "  A[Root learning question] --> B[Mechanism route]",
            "  A --> C[Boundary route]",
            "  A --> D[Example route]",
            "  B --> E[Review hook]",
            "  C --> F[Common confusion]",
            "  D --> G[Application scene]",
            "```",
            "",
            "This synthetic map is long enough to exercise the artifact validator and shows a readable route from root question to branches, boundaries, examples, and review hooks.",
        ]
    )


def _synthetic_heading_for_index(index: int) -> str:
    chapter_index = (index - 1) // 3 + 1
    section_index = (index - 1) % 3 + 1
    return f"### {chapter_index}.{section_index} Complete learning unit {index}"


def _make_trace(material_id: str, artifact: str, block_ids: list[str], mode: str) -> dict[str, Any]:
    links: list[dict[str, Any]] = []
    if mode == "empty":
        links = []
    elif mode == "unknown_block":
        links = [
            {
                "target_id": "section_001",
                "target_title": "Unknown trace target",
                "target_heading": "### 1.1 Unknown trace target",
                "source_index_entry_ids": ["src_block_999"],
                "block_ids": ["block_999"],
                "coverage_note": "This intentionally points to a missing block.",
                "confidence": "low",
            }
        ]
    else:
        usable_blocks = block_ids[:12] or ["block_001"]
        links = [
            {
                "target_id": f"section_{index:03d}",
                "target_title": f"Complete learning unit {index}",
                "target_heading": _synthetic_heading_for_index(index),
                "source_index_entry_ids": [f"src_{block_id}"],
                "block_ids": [block_id],
                "coverage_note": "Synthetic trace link for protocol eval.",
                "confidence": "high",
            }
            for index, block_id in enumerate(usable_blocks, start=1)
        ]
    return {
        "schema_version": "shijie.trace-map.v0.1",
        "material_id": material_id,
        "artifact": artifact,
        "status": "ready",
        "purpose": "Synthetic trace map for eval.",
        "links": links,
    }


def _write_strict_evidence(material_path: Path, block_ids: list[str], mode: str) -> None:
    work_dir = material_path / "content_draft" / "work"
    page_plan_dir = work_dir / "learning_page_plans"
    candidate_dir = work_dir / "source_cards" / "candidates"
    required_dir = work_dir / "source_cards" / "required"
    claims_dir = work_dir / "published_claims"
    usable_blocks = block_ids[:12] or ["block_001"]

    learning_pages: list[dict[str, Any]] = []
    candidate_lines: list[str] = []
    required_lines: list[str] = []
    claim_lines: list[str] = []

    for index, block_id in enumerate(usable_blocks, start=1):
        candidate_id = f"candidate_{index:03d}"
        card_id = f"card_{index:03d}"
        heading = _synthetic_heading_for_index(index)
        if mode == "unknown_heading":
            heading = f"### Detached evidence page {index}"
        excerpt = (
            f"Synthetic source excerpt for block {block_id}. It includes mechanism, boundary, "
            "example, misconception, and review hook evidence for protocol testing."
        )
        learning_pages.append(
            {
                "page_id": f"page_{index:03d}",
                "target_heading": heading,
                "node_ids": [f"node_{index:03d}"],
                "required_source_card_ids": [card_id],
                "content_slots": [
                    "definition_or_positioning",
                    "mechanism_or_reasoning",
                    "boundary_or_exception",
                    "example_or_review_question",
                ],
            }
        )
        candidate_lines.append(
            json.dumps(
                {
                    "card_id": candidate_id,
                    "source_index_entry_ids": [f"src_{block_id}"],
                    "block_ids": [block_id],
                    "excerpt": excerpt,
                    "topic_ids": [f"topic_{index:03d}"],
                    "why_candidate": "Synthetic candidate evidence for strict validator testing.",
                },
                ensure_ascii=False,
            )
        )
        required_lines.append(
            json.dumps(
                {
                    "card_id": card_id,
                    "candidate_card_id": candidate_id,
                    "branch_id": "branch_001",
                    "source_index_entry_ids": [f"src_{block_id}"],
                    "block_ids": [block_id],
                    "excerpt": excerpt,
                    "supports": ["mechanism", "boundary", "example"],
                    "risk_note": "Synthetic locked evidence; no real factual claim.",
                },
                ensure_ascii=False,
            )
        )
        claim_card_id = card_id
        if mode == "unplanned_claim_card":
            next_index = 1 if index == len(usable_blocks) else index + 1
            claim_card_id = f"card_{next_index:03d}"
        claim_lines.append(
            json.dumps(
                {
                    "claim_id": f"claim_{index:03d}",
                    "target_heading": heading,
                    "claim": f"Synthetic learning unit {index} explains a mechanism, boundary, and review hook.",
                    "required_source_card_ids": [claim_card_id],
                    "coverage_role": "published_learning_unit",
                },
                ensure_ascii=False,
            )
        )

    _write_json(page_plan_dir / "manifest.json", {"schema_version": "shijie.learning-page-plan.v0.1", "learning_pages": learning_pages})
    _write_text(candidate_dir / "candidates.jsonl", "\n".join(candidate_lines))
    _write_text(required_dir / "required.jsonl", "\n".join(required_lines))
    _write_text(claims_dir / "all_claims.jsonl", "\n".join(claim_lines))


def _write_ready_case(material_path: Path, spec: CaseSpec) -> None:
    manifest = _read_json(material_path / "manifest.json")
    material_id = str(manifest.get("material_id") or "synthetic_eval")
    block_ids = _source_block_ids(material_path)
    work_dir = material_path / "content_draft" / "work"
    review_dir = material_path / "content_draft" / "review_exports"
    indexes_dir = material_path / "indexes"

    _write_json(
        work_dir / "knowledge_tree.json",
        {
            "schema_version": "shijie.knowledge-tree.v0.1",
            "root_question": "How does the synthetic material become a study package?",
            "main_branches": [{"branch_id": "branch_001", "title": "Protocol route", "child_nodes": []}],
        },
    )
    _write_json(
        work_dir / "coverage_matrix.json",
        {
            "schema_version": "shijie.coverage-matrix.v0.1",
            "branches": [{"branch_id": "branch_001", "title": "Protocol route", "draft_status": "published"}],
            "topics": [{"topic_id": "topic_001", "branch_id": "branch_001", "coverage_status": "published"}],
        },
    )
    _write_text(work_dir / "block_reread_ledger.jsonl", json.dumps({"block_id": block_ids[0] if block_ids else "block_001"}) + "\n")
    _write_json(work_dir / "concept_graph.json", {"schema_version": "shijie.concept-graph.v0.1", "nodes": [], "edges": []})
    _write_text(work_dir / "self_check.md", "# Self Check\n\nSynthetic case has final artifacts for protocol evaluation.")
    _write_text(material_path / "content_draft" / "learning_notes.md", _make_learning_notes(spec.notes_mode, block_ids))
    _write_text(material_path / "content_draft" / "chapter_mindmap.md", _make_mindmap())
    _write_json(indexes_dir / "learning_notes_trace.json", _make_trace(material_id, "learning_notes.md", block_ids, spec.trace_mode))
    _write_json(indexes_dir / "chapter_mindmap_trace.json", _make_trace(material_id, "chapter_mindmap.md", block_ids, spec.trace_mode))
    if spec.evidence_mode != "missing":
        _write_strict_evidence(material_path, block_ids, spec.evidence_mode)
    _write_text(
        review_dir / "quality_audit_report.md",
        "\n".join(
            [
                "---",
                "schema_version: shijie.quality-audit-report.v0.1",
                f"audit_result: {spec.audit_result}",
                "recommended_stage: none" if spec.audit_result == "pass" else "recommended_stage: needs_deepening",
                "---",
                "",
                "# Quality Audit Report",
                "",
                f"Synthetic audit result: {spec.audit_result}.",
            ]
        ),
    )
    state = _read_json(material_path / "run_state.json")
    state.update(
        {
            "stage": "learning_notes_ready",
            "current_stage": "learning_notes_ready",
            "importable": False,
            "pipeline_ready": False,
            "audit_ready": False,
            "release_ready": False,
        }
    )
    _write_json(material_path / "run_state.json", state)
    _write_json(work_dir / "run_state.json", state)


def run_eval(output_dir: Path, target_chars: int) -> dict[str, Any]:
    output_dir = _ensure_inside_output(output_dir)
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    base_root = output_dir / "base"
    base_material = _generate_base_material(base_root, target_chars)
    cases_root = output_dir / "cases"
    cases_root.mkdir(parents=True, exist_ok=True)

    cases = [
        CaseSpec("valid_ready", True, True, "adequate", "valid", "pass", "valid"),
        CaseSpec("fake_ready_thin", False, False, "thin", "valid", "pass", "valid"),
        CaseSpec("fake_ready_empty_trace", False, False, "adequate", "empty", "pass", "valid"),
        CaseSpec("fake_ready_unknown_trace", False, False, "adequate", "unknown_block", "pass", "valid"),
        CaseSpec("fake_ready_missing_strict_evidence", False, False, "adequate", "valid", "pass", "missing"),
        CaseSpec("fake_ready_orphan_evidence_heading", False, False, "adequate", "valid", "pass", "unknown_heading"),
        CaseSpec("fake_ready_claim_card_mismatch", False, False, "adequate", "valid", "pass", "unplanned_claim_card"),
        CaseSpec("audit_needs_fix", True, False, "adequate", "valid", "needs_fix", "valid"),
    ]

    results: list[dict[str, Any]] = []
    for spec in cases:
        case_path = cases_root / f"{spec.name}.course_material"
        shutil.copytree(base_material, case_path)
        _write_ready_case(case_path, spec)
        evaluation = _evaluate_package(case_path)
        passed = (
            evaluation["pipeline_ready"] == spec.expected_pipeline_ready
            and evaluation["audit_ready"] == spec.expected_audit_ready
        )
        results.append(
            {
                "name": spec.name,
                "path": str(case_path),
                "expected_pipeline_ready": spec.expected_pipeline_ready,
                "expected_audit_ready": spec.expected_audit_ready,
                "passed": passed,
                **evaluation,
            }
        )

    report = {
        "schema_version": "shijie.synthetic-eval-report.v0.1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target_chars": target_chars,
        "base_material_path": str(base_material),
        "report_path": str(output_dir / "synthetic_300k_report.json"),
        "passed": all(item["passed"] for item in results),
        "results": results,
    }
    _write_json(output_dir / "synthetic_300k_report.json", report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Run synthetic material pipeline evals.")
    parser.add_argument("--target-chars", type=int, default=300_000)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    report = run_eval(args.output_dir, args.target_chars)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
