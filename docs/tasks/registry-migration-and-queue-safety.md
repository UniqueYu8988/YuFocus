# 任务：注册表迁移与队列数据保护

创建日期：2026-06-19
状态：已完成

## 1. 目标

1. 把视频注册表真实路径修正为 `data/registry/{up_id}.json`。
2. 安全迁移并核验当前根目录 `registry/` 下的 4 个注册表文件。
3. 验证多次刷新不丢视频、不重复。
4. 验证批量入队和 `subtitle_only` 主线不受影响。
5. 让“清空任务队列”默认只清理队列记录，不删除 `data/materials` 资料包。
6. 完成桌面端真实小样本回归。
7. 收敛文档和未提交工作区，建立稳定 Git 存档点。

## 2. 背景

- 代码和文档声明注册表位于 `data/registry`，但开发运行时实际写入了项目根目录 `registry/`。
- 当前 4 个注册表文件均可解析，每个包含 30 条视频，文件内没有重复 BV 号。
- 当前“清空任务队列”会遍历材料目录并删除资料包，已有一次疑似误操作造成数据损失。
- 工作区包含一整轮尚未提交的产品收束、目录迁移和数据层修改，本任务需要在保留这些改动的前提下完成验证和存档。

## 3. 本次范围

- 修正注册表标准数据根和相关检查。
- 对 4 个现有注册表做先复制、核验、再处理旧目录的安全迁移。
- 增加注册表迁移与重复刷新验证。
- 修改清空队列语义，使其不删除材料数据。
- 增加清空队列纯内存数据保护检查。
- 执行相关静态检查、类型检查、桌面端受控回归和 Git diff 检查。
- 更新必要的产品、架构、状态和验收文档。

## 4. 明确不做

- 不恢复已丢失的历史资料包或队列。
- 不修改 `distiller.py` 的核心流程。
- 不拆分 `WorkspacePane.tsx`。
- 不新增依赖，不更换框架。
- 不批量运行大量真实视频。
- 不展示或提交 Cookie、API Key、令牌和授权码。

## 5. 验收标准

- [x] 运行时注册表路径为 `data/registry`。
- [x] 4 个文件迁移前后 SHA256、文件大小和 JSON 统计一致。
- [x] 连续多次刷新不会删除历史视频，不会产生重复 BV。
- [x] 批量入队仍显式使用 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- [x] `subtitle_only` 不触发总结、邮件或 TTS。
- [x] 清空队列不会删除任何资料包文件。
- [x] 受控桌面端回归通过，真实小样本不超过 1 条。
- [x] 相关自动检查、类型检查、构建和 Git diff 检查通过。
- [x] 文档与代码一致，工作区建立可回退的 Git 存档点。

## 6. 相关文件和数据

- `registry/*.json`
- `data/registry/*.json`
- `data/materials/`
- `desktop/electron/services/videoRegistry.ts`
- `desktop/electron/runtime/runtimePaths.ts`
- `desktop/electron/services/materialDeletion.ts`
- `desktop/electron/ipc/sourceIpcHandlers.ts`
- `desktop/electron/main.ts`
- `desktop/src/ui/pages/WorkspacePane.tsx`
- `desktop/scripts/check-video-registry-layer.mjs`
- `desktop/scripts/check-subtitle-only-queue-mode.mjs`

## 7. 风险

- 覆盖或遗漏真实注册表文件。
- 启动桌面端时意外触发队列或外部服务。
- 工作区已有大量改动，存档时可能漏掉新目录或误纳入运行数据。
- 清空队列语义变化需要同步 UI 提示、类型和验收文档。

## 8. 验证方式

- 自动测试：注册表临时目录测试、清空队列纯内存测试、subtitle-only 检查、数据层检查。
- 人工验收：桌面端受控启动、来源刷新、批量选择小样本和队列清理保护。
- 构建或类型检查：`npx tsc --noEmit`、核心 Python `py_compile`。

## 9. 完成记录

- 注册表路径根因是运行时 `dataRoot` 实际表示项目运行根；现改为显式 `canonicalDataRoot`，主进程统一解析并传递 `data/registry`。
- 4 个旧文件迁移前后 SHA256 完全一致，并备份到 `data/backups/registry-pre-migration-20260619`；项目根 `registry/` 已移除。
- 指定来源连续真实刷新后保持 30 条、30 个唯一 BV、0 重复；API 未更新时仍保留本地列表。
- 批量选择 2 条视频时 UI 数量和按钮状态正确；自动检查确认批量入队与后台发现都使用 subtitle-only。
- `BV131jF68E5n` 真实小样本在 `data/materials/256724889/bv131jf68e5n` 完成，`run_state=content_ready`、`summary_status=skipped`，summary / 邮件 / TTS 调用均为 0。
- 清空 2 条已完成队列记录的真实 IPC 回归返回 0 个材料删除，材料路径保持不变；队列记录随后恢复。
- Store 迁移和清队列回归前均创建独立备份；未公开秘密值。
- 自动检查、TypeScript、Python 语法检查和 `npm run build:web` 均通过。
