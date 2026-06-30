# 任务：长期资料库文件管理改造

创建日期：2026-07-01
状态：已完成

## 1. 目标

为长期积累几千条视频建立更适合使用和维护的文件管理方式：把用户真正使用的成品文件从单视频工作目录中抽离出来，形成按 UP 主分组的 NotebookLM 清洗稿库和邮件稿库，并建立轻量索引和去重机制。

## 2. 用户需求总结

- 清洗稿需要按 UP 主建立文件夹，方便直接把同一 UP 的资料导入 NotebookLM。
- 每个 UP 文件夹内直接放视频对应的 Markdown 文件，尽量按视频发布时间排序。
- 邮件稿单独建立一套文件夹，逻辑和清洗稿一致。
- 文件命名尽量复刻视频标题，同时要适配 Windows 文件名规则。
- 如果可行，把文件修改时间设置为视频发布日期，方便系统资源管理器自动排序。
- 单视频处理完成后，长期只保留 NotebookLM 清洗稿和邮件稿两类有效文件。
- 原始字幕、缓存、转写中间物等原材料后续希望自动删除。
- 需要保留必要轻量记录，例如视频 id、标题、UP、发布日期、生成时间、成品路径和处理状态，用于防止重复制作同一条视频。

## 3. 本次范围

第一阶段只做非破坏性落地：

- 新增长期成品库结构。
- 材料包完成后，同步生成 NotebookLM 清洗稿成品文件和邮件稿成品文件。
- 生成或更新轻量索引，记录 BV / UP / 发布日期 / 成品路径 / 来源材料包。
- 文件名做安全清洗，避免 Windows 禁止字符。
- 尝试把成品文件修改时间设置为视频发布日期；拿不到发布日期时保持生成时间。
- 增加自动检查，确保不会删除 `data/materials`。

## 4. 明确不做

- 本阶段不删除、移动、重命名任何已有 `data/materials` 真实材料。
- 本阶段不清空缓存、不删除原始字幕、不删除转写中间文件。
- 本阶段不迁移旧材料包，不批量改写历史数据。
- 本阶段不改变 NotebookLM 正文内容、邮件正文内容、MiMo 清洗、本地 Ollama 总结或 SMTP 发送逻辑。
- 本阶段不引入数据库或新依赖。

## 5. 建议的新目录

```text
data/library/
├── index.json
├── notebooklm/
│   └── {up_name_or_mid}/
│       └── {date} {title} [{bvid}].md
└── email/
    └── {up_name_or_mid}/
        └── {date} {title} [{bvid}].md
```

说明：

- `{up_name_or_mid}` 优先用 UP 主名称，名称不可用时用 mid。
- `{date}` 使用视频发布日期，格式为 `YYYY-MM-DD`，用于跨平台稳定排序。
- `{title}` 尽量保留原标题，但会删除 Windows 禁止字符并限制长度。
- `[{bvid}]` 用于防重，避免同标题视频互相覆盖。

## 6. 后续清理阶段草案

原材料自动删除必须单独进入第二阶段，并满足：

- 有明确开关，默认关闭或先干跑。
- 只清理已成功同步到长期成品库且索引完整的材料包。
- 删除前能列出将删除的文件类型和保留文件。
- 至少有一次临时目录自动检查和一次小样本人工确认。
- 不删除 `data/registry`、Electron Store、运行日志和长期成品库。

## 7. 验收标准

- [x] 任务和计划文件已建立。
- [x] 新增长期成品库同步服务。
- [x] 队列完成材料包后会同步成品文件和索引。
- [x] NotebookLM 清洗稿和邮件稿分别进入独立目录。
- [x] 文件名 Windows 安全，且包含 BV 防重。
- [x] 有发布日期时，成品文件修改时间设为视频发布日期。
- [x] 检查脚本证明本阶段不删除 `data/materials`。
- [x] 类型检查通过。

## 8. 风险

- 文件名复刻标题时可能过长或包含非法字符，需要统一清洗。
- 修改文件时间是系统层行为；如果视频发布时间缺失或异常，应安全跳过。
- 如果未来自动删除原材料，必须确认长期成品库和索引已经完整，否则会丢失可追溯信息。

## 9. 完成记录

完成时间：2026-07-01

- 新增 `desktop/electron/services/libraryExportService.ts`，负责把单视频材料包里的 `exports/notebooklm.md` 和 `delivery/email.md` 同步到 `data/library`。
- 新增长期目录规则：
  - `data/library/notebooklm/{UP 主}/视频标题.md`
  - `data/library/email/{UP 主}/视频标题.md`
  - `data/library/index.json`
- 队列完成材料后会调用长期成品库同步；同步失败不会删除原材料，也不会让字幕清洗结果丢失，只会在队列记录里留下提示。
- 文件名会清理 Windows 禁止字符；默认只保留标题，同一 UP 下标题冲突时才追加 ` (2)` 这类短后缀。
- 有视频发布日期时，成品文件修改时间会设置为视频发布日期；发布时间和 BV 同时保存在索引中。
- `index.json` 使用 BV / sourceId 去重，记录标题、UP、发布日期、来源材料包和成品路径。
- 本阶段没有启用原材料自动删除；原材料清理留到第二阶段，需要备份、开关和 dry-run 检查。
- 验证：`node desktop/scripts/check-long-term-library-export.mjs`、`node desktop/scripts/check-data-layer-normalization.mjs`、`node desktop/scripts/check-product-refactor-surface.mjs`、`node desktop/scripts/check-fresh-email-delivery.mjs`、`node desktop/scripts/check-up-sync-scheduler.mjs`、`node desktop/scripts/check-subtitle-only-queue-mode.mjs`、`npx tsc --noEmit`、`npm run build:portable`、`node desktop/scripts/check-packaged-portable-smoke.mjs` 和 `git diff --check` 均通过；`git diff --check` 只有 Windows 换行提示。
