# 任务：加强精读稿格式契约检查

创建日期：2026-06-12
状态：已完成

## 1. 目标

加强 `src/check_editorial_email_contract.py` 对当前短视频精读稿 Markdown / HTML 输出行为的自动检查。

本任务只保护现有行为，不设计新的产品格式。

## 2. 背景

代码风险审计已确认，`src/check_editorial_email_contract.py` 是第一个低风险代码稳定化任务。它只调用 `src/distiller.py` 中现有的 Markdown 规范化和 HTML 渲染函数，不读取真实材料包，不调用 MiMo、邮件、TTS 或其他外部服务。

## 3. 本次范围

- 修改 `src/check_editorial_email_contract.py`。
- 必要时在脚本内增加静态测试样例。
- 更新本任务文件。
- 按实际变化更新 `CURRENT_STATE.md`。

## 4. 明确不做

- 不修改 `src/distiller.py`。
- 不修改生产输出格式。
- 不修改提示词。
- 不定义新的稿件栏目、长度或内容结构。
- 不调用 MiMo、邮件、TTS 或其他外部服务。
- 不读取或修改真实材料包。
- 不修改队列、AppData 或用户数据。
- 不拆分大文件。
- 不处理其他代码问题。
- 不更新依赖。

## 5. 开始前分析

### 原脚本已经保护的行为

- 旧“关键原话”板块会从读者正文中移除。
- 旧“事实、判断与边界”板块会从读者正文中移除。
- `🗞️ 核心判断` 这类旧标题 emoji 会被移除。
- `核心判断` 标题保持普通标题。
- 核心判断引用行不应加粗。
- `问题线索`、`核心拆解` 等旧标题会改成当前生产代码中的固定标题。
- HTML 使用浅色邮件样式，包含内联正文颜色、文章背景、标题颜色和 light color-scheme meta。

### 当前生产代码实际输出

- `build_editorial_summary_content()` 在成功或兜底成功时写出：
  - `summary/article.md`
  - `summary/article.html`
  - `summary/cards.json`
  - `summary/review.json`
  - `summary/summary_status.json`
- `article.md` 来自 `_normalize_editorial_article_markdown()` 规范化后的 Markdown。
- `article.html` 来自 `_render_simple_email_html(article_md, title, source)`。
- `_render_simple_email_html()` 会再次规范化 Markdown，渲染 `h1`、来源行、section、标题、段落、列表和引用。

### 缺少检查的现有行为

- Markdown 和 HTML 是否都有基本结构。
- HTML 是否包含正文，而不是只有外壳。
- Markdown 与 HTML 是否来自同一份内容。
- 是否混入调试文本、内部状态或秘密字段名。
- 空内容或明显异常内容是否能被检查脚本识别。
- 脚本是否能在 Windows 路径和 UTF-8 文本下稳定运行。

### 本次准备增加的检查

- 增加 Markdown 基本结构检查。
- 增加 HTML 基本结构和正文存在检查。
- 增加 Markdown 与 HTML 同源检查。
- 增加禁止调试文本、内部状态和秘密字段名的检查。
- 增加失败样例，确认检查脚本确实能拦截异常输出。

这些检查只验证当前生产函数已经输出的结构和内容，不改变产品格式，也不新增稿件栏目。

## 6. 验收标准

- [x] `python src/check_editorial_email_contract.py` 通过。
- [x] 修改后的 Python 文件可被 `ast.parse` 解析。
- [x] 脚本没有网络访问。
- [x] 脚本没有读取或修改真实材料目录。
- [x] 故意构造的失败样例能被脚本识别。
- [x] 文件差异没有无关修改。

## 7. 相关文件和数据

- `src/check_editorial_email_contract.py`
- `src/distiller.py`
- `CURRENT_STATE.md`

不涉及真实材料包、Electron Store、AppData、队列或外部服务。

## 8. 风险

- 如果检查写得过度，会把现有合法输出误判为失败。
- 如果检查依赖具体产品文案，会变成新的产品格式设计。
- 如果导入或执行了生产流程函数，可能触发网络或文件写入；本任务只允许调用纯格式函数。

## 9. 验证方式

- 自动测试：`python src/check_editorial_email_contract.py`
- 语法检查：使用 `ast.parse` 解析 `src/check_editorial_email_contract.py`
- 安全检查：搜索脚本是否包含网络访问、真实材料路径读写或文件写入调用
- 差异检查：`git diff -- src/check_editorial_email_contract.py CURRENT_STATE.md docs/tasks/strengthen-editorial-contract-check.md`

## 10. 完成记录

已完成。

### 修改内容

- 将原脚本中的单组布尔检查整理为 `validate_editorial_contract()`。
- 保留原有检查：旧低收益板块移除、旧标题规范化、核心判断不加粗、浅色邮件样式和内联样式。
- 新增 Markdown 基本结构检查：
  - 正文非空；
  - 标题存在；
  - `核心判断`、`核心线索`、`问题拆解` 等当前生产代码已使用的基本结构存在；
  - 至少包含多个二级标题。
- 新增 HTML 基本结构检查：
  - `doctype`、`html lang="zh-CN"`、`head`、`body`、`main.wrap`、`article.article` 存在；
  - HTML 中有标题、来源、可阅读正文；
  - HTML 中能找到来自 Markdown 的关键正文片段。
- 新增 Markdown / HTML 同源检查：用静态样例中的正文片段确认两者来自同一份内容。
- 新增禁止输出标记检查：拦截明显的秘密字段名、调试文本和内部状态字段名。
- 新增 `BROKEN_ARTICLE` 负样例，确认脚本能识别异常输出，而不是永远通过。

### 验证结果

- `python src/check_editorial_email_contract.py`：通过。
- 负样例结果：`expected_failure_detected=true`，失败项包括空内容、缺少结构、正文不同源、秘密/内部字段名等。
- `ast.parse` 解析 `src/check_editorial_email_contract.py`：通过。
- 静态搜索脚本：未发现 `requests`、`urllib`、`httpx`、`socket`、`smtplib`、文件读写、`output/materials`、AppData、Electron Store、`knowledge_library` 或 `.course_material` 访问标记。
- 本轮未执行 MiMo、邮件、TTS、来源刷新、制作、删除、队列或 Electron 启动。

### 未做内容

- 未修改 `src/distiller.py`。
- 未修改生产输出格式。
- 未修改提示词。
- 未定义新的稿件栏目、长度或内容结构。

### 回退方式

只需回退 `src/check_editorial_email_contract.py` 的本次改动，以及本任务文件和 `CURRENT_STATE.md` 中对应状态记录。
