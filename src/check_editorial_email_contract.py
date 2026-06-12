from __future__ import annotations

import json

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


def main() -> int:
    source = SourceDescriptor(
        source_type="test",
        source_id="BV_TEST",
        title="测试标题",
        creator="视界专注",
        url="https://www.bilibili.com/video/BV_TEST",
    )
    normalized = _normalize_editorial_article_markdown(SAMPLE_ARTICLE)
    rendered = _render_simple_email_html(normalized, title="测试标题", source=source)

    checks = {
        "key_quotes_removed": "关键原话" not in normalized and "这类原话板块" not in normalized,
        "fact_boundary_removed": "事实、判断与边界" not in normalized and "低收益板块" not in normalized,
        "old_takeaway_emoji_removed": "🗞️" not in normalized,
        "core_heading_plain": "## 核心判断" in normalized,
        "core_line_unbolded": "**核心判断也不该" not in normalized and "> 核心判断也不该" in normalized,
        "fixed_thread_heading": "## 🧭 核心线索" in normalized,
        "fixed_breakdown_heading": "## 🔎 问题拆解" in normalized,
        "inline_body_color": '<body bgcolor="#f5f6f8"' in rendered and "color:#1f2937" in rendered,
        "inline_article_background": '<article class="article" bgcolor="#ffffff"' in rendered,
        "inline_heading_color": '<h2 style="' in rendered and "color:#667085" in rendered,
        "mobile_color_meta": 'name="color-scheme" content="light"' in rendered
        and 'name="supported-color-schemes" content="light"' in rendered,
        "dark_theme_absent": "color-scheme: dark" not in rendered and "background:#191a20" not in rendered,
    }
    failed = [name for name, ok in checks.items() if not ok]
    print(json.dumps({"ok": not failed, "checks": checks, "failed": failed}, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
