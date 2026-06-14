from __future__ import annotations

import json
import re

from distiller import SourceDescriptor, _normalize_editorial_article_markdown, _render_simple_email_html


SAMPLE_ARTICLE = """# 测试标题
> **这是一句不该加粗的开篇判断。**

## 🗞️ 核心判断
> **核心判断也不该在首屏加粗。**

## 问题线索：旧标题带副标题
这里是正文。

## 核心拆解：旧标题带副标题
- **局部重点** 可以保留。

## ⚖️ 事实、判断与边界
- 这类低收益板块不再进入读者正文。

## 💬 关键原话
> 这类原话板块不再进入读者正文。
"""


BROKEN_ARTICLE = """# 空壳测试

调试信息：api_key=SHOULD_NOT_APPEAR
summary_status.json
"""


FORBIDDEN_OUTPUT_MARKERS = [
    "api_key",
    "apikey",
    "cookie",
    "sessdata",
    "smtp",
    "authorization",
    "bearer ",
    "debug",
    "traceback",
    "summary_status",
    "run_state",
    "internal",
]


def build_test_source() -> SourceDescriptor:
    return SourceDescriptor(
        source_type="test",
        source_id="BV_TEST",
        title="测试标题",
        creator="视界专注",
        url="https://www.bilibili.com/video/BV_TEST",
    )


def contains_forbidden_marker(*values: str) -> bool:
    haystack = "\n".join(values).lower()
    return any(marker in haystack for marker in FORBIDDEN_OUTPUT_MARKERS)


def validate_editorial_contract(markdown_text: str, *, title: str, source: SourceDescriptor) -> dict[str, bool]:
    normalized = _normalize_editorial_article_markdown(markdown_text)
    rendered = _render_simple_email_html(normalized, title=title, source=source)

    visible_text_markers = ["核心判断", "核心线索", "问题拆解", "这里是正文", "局部重点"]
    markdown_h2_count = len(re.findall(r"^##\s+", normalized, flags=re.MULTILINE))

    return {
        "markdown_not_empty": len(normalized.strip()) >= 80,
        "markdown_title_present": normalized.startswith(f"# {title}"),
        "markdown_has_core_structure": "## 核心判断" in normalized and "## 🧭 核心线索" in normalized and "## 🔎 问题拆解" in normalized,
        "markdown_has_multiple_sections": markdown_h2_count >= 3,
        "key_quotes_removed": "关键原话" not in normalized and "这类原话板块" not in normalized,
        "fact_boundary_removed": "事实、判断与边界" not in normalized and "低收益板块" not in normalized,
        "old_takeaway_emoji_removed": "🗞️" not in normalized,
        "core_heading_plain": "## 核心判断" in normalized,
        "core_line_unbolded": "**核心判断也不该" not in normalized and "> 核心判断也不该" in normalized,
        "fixed_thread_heading": "## 🧭 核心线索" in normalized,
        "fixed_breakdown_heading": "## 🔎 问题拆解" in normalized,
        "html_document_structure": "<!doctype html>" in rendered and '<html lang="zh-CN">' in rendered and "</html>" in rendered,
        "html_email_structure": "<head>" in rendered and "<body" in rendered and '<main class="wrap"' in rendered and '<article class="article"' in rendered,
        "html_title_and_source_present": f"<title>{title}</title>" in rendered and source.source_id in rendered and source.creator in rendered,
        "html_contains_readable_body": all(marker in rendered for marker in visible_text_markers)
        and ("<blockquote" in rendered or "<p" in rendered or "<li" in rendered),
        "markdown_html_same_content": all(marker in normalized and marker in rendered for marker in visible_text_markers),
        "forbidden_markers_absent": not contains_forbidden_marker(normalized, rendered),
        "inline_body_color": '<body bgcolor="#f5f6f8"' in rendered and "color:#1f2937" in rendered,
        "inline_article_background": '<article class="article" bgcolor="#ffffff"' in rendered,
        "inline_heading_color": '<h2 style="' in rendered and "color:#667085" in rendered,
        "mobile_color_meta": 'name="color-scheme" content="light"' in rendered
        and 'name="supported-color-schemes" content="light"' in rendered,
        "dark_theme_absent": "color-scheme: dark" not in rendered and "background:#191a20" not in rendered,
    }


def main() -> int:
    source = build_test_source()

    passing_checks = validate_editorial_contract(SAMPLE_ARTICLE, title="测试标题", source=source)
    failing_checks = validate_editorial_contract(BROKEN_ARTICLE, title="空壳测试", source=source)

    failed = [name for name, ok in passing_checks.items() if not ok]
    expected_failure_names = [name for name, ok in failing_checks.items() if not ok]
    expected_failure_detected = bool(expected_failure_names)

    result = {
        "ok": not failed and expected_failure_detected,
        "checks": passing_checks,
        "failed": failed,
        "negative_sample": {
            "would_pass": not expected_failure_detected,
            "expected_failure_detected": expected_failure_detected,
            "failed_checks": expected_failure_names,
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
