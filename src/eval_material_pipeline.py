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


def _audit_result(path: Path) -> str:
    if not path.exists():
        return "missing"
    content = path.read_text(encoding="utf-8")
    match = re.search(r"^\s*audit_result\s*:\s*(pass|needs_fix|blocked|unknown)\s*$", content, re.IGNORECASE | re.MULTILINE)
    if match:
        return match.group(1).lower()
    return "unknown"


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
    else:
        notes = learning_notes_path.read_text(encoding="utf-8")
        plain = _plain_length(notes)
        h1_count = len(re.findall(r"^#\s+", notes, flags=re.MULTILINE))
        h3_lengths = _heading_body_lengths(notes, 3)
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
                "target_title": f"Synthetic learning unit {index}",
                "target_heading": f"### Synthetic learning unit {index}",
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
        CaseSpec("valid_ready", True, True, "adequate", "valid", "pass"),
        CaseSpec("fake_ready_thin", False, False, "thin", "valid", "pass"),
        CaseSpec("fake_ready_empty_trace", False, False, "adequate", "empty", "pass"),
        CaseSpec("fake_ready_unknown_trace", False, False, "adequate", "unknown_block", "pass"),
        CaseSpec("audit_needs_fix", True, False, "adequate", "valid", "needs_fix"),
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
