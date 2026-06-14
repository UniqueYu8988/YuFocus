# 视频自动编稿生产线

更新时间：2026-05-28

本文记录视界专注的新默认方向：长视频只做清洗与 NotebookLM 前置资料，短视频走 API 自动编稿，最终面向邮箱日报阅读。

软件内的 `流程` 页面是本文档的透明入口：它展示长视频路线、短视频路线、自动化原则，并通过白名单文件读取让用户直接查看项目语境、编稿流程、邮件合同检查和 distiller 核心逻辑。

## 产品定位

短视频不再走 Codex Goal 打包制作路线。软件应在后台完成：

```text
关注源 / BV / 本地音视频
  -> 字幕提取或本地转写
  -> MiMo 清洗字幕
  -> 轻量多通路编辑
  -> 主编合稿
  -> 轻量忠实性审稿
  -> Markdown / HTML / 结构化卡片
  -> 后续邮件推送
```

长视频仍然生成：

```text
content.md
exports/notebooklm.md
blocks/
indexes/
```

长视频默认不进入自动总结或学习笔记深写。

## 编稿原则

- 目标是精品日报稿，不是普通摘要。
- 压缩表达，不压缩信息关系。
- 保留观点、因果、转折、限定条件和关键例子，不把每类信息拆成独立模板板块。
- 多通路编辑用于提高文稿质量，不用于凑字数、套模板或堆审稿材料。
- MiMo 不负责实时外部事实核查；第一阶段只做字幕忠实性审稿。

## 多通路

当前固定通路：

```text
类型判断员
信息抽取员
主线编辑
主编
忠实性审稿员
```

各通路职责：

- 类型判断员：给主编编辑取向，不强制套不同模板。
- 信息抽取员：抽取支撑正文的观点、论证、例子、定义、背景和预测。
- 主线编辑：还原视频表达路径，让文章不散。
- 主编：基于结构化材料合成一篇自然、清晰、适合邮件阅读的精品视频稿，不再二次吞完整字幕。
- 忠实性审稿员：基于结构化材料做轻量审稿，检查是否有明显无支撑扩写。

## 产物

短视频编稿产物写入 `.course_material/summary/`：

```text
summary/article.md              最终精品视频稿源稿
summary/article.html            邮件阅读与专注页 HTML 渲染稿
summary/cards.json              信息卡与结构化抽取结果
summary/review.json             忠实性审稿结果
summary/meta.json               编稿状态、路径、模型用量和路由信息
summary/summary_status.json     制作页状态入口
../metrics.json                  字幕清洗与编稿阶段的耗时、token 和产物规模总账
summary/work/type_brief.json
summary/work/information_extraction.json
summary/work/mainline.md
summary/work/fidelity_review.raw.json
```

## HTML 阅读路线

HTML 是长期推荐的展示与邮件格式，但 Markdown 仍保留为可编辑、可检索、可降级的源稿。

当前策略：

- `summary/article.md` 是生产源稿，负责内容和结构，也作为可编辑、可检索、可降级文本。
- `summary/article.html` 是面向邮件与软件专注页的渲染稿。
- 专注页打开短视频精读稿时，会把 Markdown 和 HTML 一起载入兼容包；阅读器优先用沙盒 iframe 渲染 HTML，HTML 缺失或不可用时回退 Markdown 文章模式。
- 未来邮件模板和桌面阅读器应共享同一篇结构化 HTML，避免维护两套互相漂移的展示样式。

HTML 渲染稿需要遵守：

- 保留大标题、二级主题、三级说明、列表、引用、表格和强调。
- 读者正文默认不展示密集时间戳；时间戳主要留在索引和内部回查线索中。
- 二级标题控制在少而稳的 3-5 个主题区；“核心判断”不加 emoji，“核心线索”和“问题拆解”使用固定 emoji 前缀。
- 不再把“关键原话”“事实”“事实、判断与边界”作为读者正文板块；这些只作为内部材料或背景支撑。
- 开篇要先给读者一个“核心判断”，用一两句话抓住最重要的结论，但不要加粗到影响阅读密度。
- HTML 渲染稿默认使用浅色邮件样式，避免手机邮箱强制改写深色正文颜色后出现黑字黑底。
- 不把正文里的调试信息、模型过程、来源索引暴露给读者。
- 邮件端的背景色、正文色、标题色、引用块和卡片底色必须写入 inline style；`<style>` 只作为桌面端和支持 CSS 的邮箱客户端增强。桌面端可以使用更丰富的样式，但两者共享同一篇结构化文章。

当前精简原则：

- 高 token 消耗但低阅读收益的固定板块先从读者正文中删掉，不再把“关键原话”“事实”“事实、判断与边界”作为每篇必备栏目。
- 事实、原话和边界判断可以留在信息卡、索引、审稿材料或回查工件中，供主编写作和必要时追溯。
- 昂贵模型调用优先用于主线理解和最终成稿；切段、去重、格式检查、邮件兼容检查等简单任务后续优先交给规则或本地模型。

## 路由

默认 `SHIJIE_EDITORIAL_SUMMARY_MODE=auto`。

自动编稿只面向短视频或信息量可控材料。当前默认路由：

```text
duration <= 1800 秒
content.md <= 30000 字符
```

这不是文稿长度限制，只是“是否进入短视频编稿线”的路由阈值。可以通过环境变量调整：

```text
SHIJIE_EDITORIAL_SUMMARY_MODE=auto|force|off
SHIJIE_EDITORIAL_SUMMARY_MAX_DURATION_SECONDS=1800
SHIJIE_EDITORIAL_SUMMARY_MAX_CONTENT_CHARS=30000
SHIJIE_MIMO_EDITORIAL_MODEL=mimo-v2.5-pro
```

制作队列规则：

- 从关注源手动勾选加入队列的视频会标记为 `queueSource=follow_source`，并以 `editorialMode=force` 进入自动流水线。
- 手动 BV 输入先加入队列，默认仍走 `auto` 路由；字幕清理完成后，任务行可点击“制作文稿”并以 `force` 模式补跑编稿。
- 已有 `.course_material` 可通过 `python src\distiller.py --summarize-material "<材料包路径>" --result-json` 单独制作精读稿；这不是 Codex Goal 入口。

## 制作状态

```text
灰灯：待处理
红灯：正在处理或处理/编稿失败
黄灯：字幕清理完成，NotebookLM 清洗稿可用
绿灯：视频精读稿或后续资料成品完成
```

## 后续阶段

1. 对真实短视频做质量抽检，调整多通路提示词和审稿标准。
2. 加入 HTML 邮件模板和单篇邮件预览。
3. 加入自动邮件发送。
4. 加入关注源定时监控。
5. 加入多视频日报合刊。
