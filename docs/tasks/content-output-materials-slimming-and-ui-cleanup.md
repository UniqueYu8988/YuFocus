# 任务：成品库优先与 materials 瘦身

创建日期：2026-07-01
状态：已完成

## 1. 目标

把软件的长期数据重心从 `data/materials` 原材料目录转向 `data/library` 成品库：用户主要获取两份 Markdown 成品，软件只保留制作中必要的轻量记录。同时修复自动同步开启后不继续处理视频的问题，并调整队列 / 档案列表的文件入口 UI。

## 2. 背景

当前 `data/library` 已按 UP 主保存 NotebookLM 清洗稿和 email 稿，且已迁移既有成品。但 `data/materials` 仍保留大量中间文件，软件内部分读取逻辑仍依赖材料包中的成品路径。用户确认：部分视频失败或误删后重跑代价可接受，长期维护更看重成品文件、简单状态记录和可删除性。

## 3. 本次范围

- 检查并修复自动同步开启后没有视频进入清洗 / 总结 / 邮件流程的问题。
- 让长期去重和档案读取识别 `data/library/index.json`，避免瘦身后重复制作同一视频。
- 增加 `materials` 瘦身机制：成品已进入 `data/library` 后，材料包只保留 manifest、metrics、run_state 和成品引用等轻量记录。
- 档案删除按钮清理该视频关联的材料包、成品库 Markdown 和索引记录。
- 队列 / 档案列表只显示清洗稿和 email 稿图标入口；无 email 稿时只显示清洗稿入口；档案额外保留删除图标。
- 档案顶部右侧两个按钮改为打开清洗稿成品库文件夹和 email 成品库文件夹。
- 修复档案页 TED 分组出现大块空白、头像行与搜索栏之间分割线过重的问题。

## 4. 明确不做

- 不修改 MiMo、SenseVoice、Ollama 模型本身。
- 不改变 fresh / history 的邮件策略：只有 fresh 新视频允许发邮件。
- 不批量删除真实材料，除非通过明确的迁移 / 瘦身脚本或用户在 UI 中点击单条删除。
- 不把完整原材料长期保存目标重新扩大。
- 不引入新的数据库或重型依赖。

## 5. 验收标准

- [x] 自动同步开启后，发现新视频时可以进入队列并启动单条处理。
- [x] 历史补全和最近更新不会因 `data/materials` 瘦身而重复处理已在成品库登记的视频。
- [x] 新完成的视频会同步到 `data/library`，并可把材料包瘦身为轻记录。
- [x] 瘦身后的档案仍能显示视频，打开清洗稿 / email 稿图标仍能定位到 Markdown 成品。
- [x] 档案删除单条视频后，该视频的材料目录、成品 Markdown 和索引记录都被清理。
- [x] 队列 / 档案列表不再显示打开、复制、定位等文字按钮，只保留对应图标。
- [x] 档案页头像区没有 TED 大空白，头像与搜索栏之间没有多余分割线。

## 6. 相关文件和数据

- `desktop/electron/services/libraryExportService.ts`
- `desktop/electron/services/materialInventory.ts`
- `desktop/electron/services/materialDeletion.ts`
- `desktop/electron/providers/sourceDiscoveryRuntime.ts`
- `desktop/electron/queue/queueExecutor.ts`
- `desktop/src/ui/panels/workspace/ArchivePaneParts.tsx`
- `desktop/src/ui/panels/workspace/WorkbenchQueueParts.tsx`
- `data/materials`
- `data/library`

## 7. 风险

- 单条删除和瘦身涉及真实文件，需要做路径边界校验，只能删除项目数据根内的目标文件。
- 如果档案扫描仍依赖已删除的中间文件，瘦身后档案可能看不到旧视频。
- 如果长期去重不读取成品库索引，瘦身后可能重复制作同一视频。
- 自动同步问题可能来自 Store 状态、队列上限、暂停状态或发现逻辑，需要先只读排查。

## 8. 验证方式

- 自动测试：新增或更新 materials 瘦身、成品库索引去重、档案 / 队列 UI 静态检查脚本。
- 人工验收：启动桌面端查看档案页头像区、搜索栏、列表图标入口；必要时使用便携版 smoke test。
- 构建或类型检查：`npx tsc --noEmit`、相关 `node desktop/scripts/*.mjs`、必要时 `npm run build:portable`。

## 9. 完成记录

2026-07-01 完成。

- 自动同步问题定位为两层：真实 Store 曾处于手动暂停；便携版队列能发现并启动视频，但因打包后端资源定位仍要求旧 `main.py` 且分享包未正确携带 `resources/backend`，导致每条任务进入重试。已修复后端资源查找和分享包资源复制，并清除真实 Store 的手动暂停标记。清除前已备份 Store：`C:\Users\Yu\AppData\Roaming\视界专注\shijie-focus-secure.json.backup-2026-06-30T19-46-07-055Z`。
- `data/library/index.json` 已进入自动发现去重集合；瘦身后的材料包通过 `library_refs.json` 和成品库索引仍能出现在档案。
- 新增 `materialSlimmingService.ts` 和 `desktop/scripts/slim-materials-to-library.mjs`。真实执行后，196 个 `data/materials` 材料包全部瘦身，删除 4360 个中间文件，最终保留 786 个轻量记录文件；`raw_transcript.txt`、材料包内 `exports/notebooklm.md` 和 `delivery/email.md` 均为 0。
- 队列和档案列表改为清洗稿 / email 稿图标入口；档案额外保留删除图标。搜索栏右侧两个文件夹按钮分别打开 `data/library/notebooklm` 和 `data/library/email`。
- 重新生成便携版：`desktop/release/视界专注_v0.1.0_x64.exe` 和 `desktop/release/视界专注_v0.1.0_share.zip`。分享包已确认包含 `resources/backend/distiller.py`、`config.py`、`bilibili_api.py` 和 `local_audio_client.py`。

验证通过：

- `node desktop/scripts/check-materials-slimming-and-library-dedupe.mjs`
- `node desktop/scripts/check-long-term-library-export.mjs`
- `node desktop/scripts/check-queue-record-feed.mjs`
- `node desktop/scripts/check-archive-up-grouping.mjs`
- `node desktop/scripts/check-recent-and-history-autopilot.mjs`
- `node desktop/scripts/check-up-sync-scheduler.mjs`
- `node desktop/scripts/check-folded-queue-issues.mjs`
- `node desktop/scripts/check-fresh-email-delivery.mjs`
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `node desktop/scripts/check-home-dashboard-safety.mjs`
- `npx tsc --noEmit`
- `python -m py_compile src\distiller.py src\bilibili_api.py src\local_audio_client.py src\config.py`
- `npm run build:portable`
- `node desktop/scripts/check-packaged-portable-smoke.mjs`
- `git diff --check`，仅有 Windows 行尾提示。
