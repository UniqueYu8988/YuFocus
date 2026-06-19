# 任务：UP 主视频注册表稳定层

创建日期：2026-06-16
状态：已完成

## 目标

为 UP 主视频列表增加本地注册表层，解决刷新后视频消失、API 返回不稳定导致列表不稳定的问题。

目标数据位置：

```text
data/registry/{up_id}.json
```

核心原则：

- B 站 API 只作为临时来源，用来发现新视频或更新元数据。
- 本地 registry 是 UI 视频列表的数据来源。
- 刷新时合并，不整表替换。
- API 暂时失败时，已有 registry 仍可读取。

## 明确不做

- 不修改 subtitle-only pipeline。
- 不修改队列执行逻辑。
- 不修改 UI 结构或视觉设计。
- 不调用真实 B 站接口做验证。
- 不启动软件。
- 不执行 Git 写操作。

## 计划

1. 阅读 UP 主来源、视频列表、IPC 和后台发现代码。
2. 新增 registry 文件读写与合并逻辑。
3. 将来源视频刷新改为 API fetch → merge registry → return registry。
4. 让队列入队继续使用稳定 `bvid` 和 registry 返回的视频对象。
5. 增加纯内存 / 临时目录检查脚本，验证不丢视频、不重复、API 失败可读旧数据。
6. 运行 TypeScript 和相关脚本验证。

## 验证

- registry merge 不会删除 API 缺失的视频。
- 多次刷新不会重复视频。
- API 失败时仍可读取 registry。
- 批量入队样例仍使用稳定 `bvid`。
- `subtitle_only` 检查仍通过。
- `npx tsc --noEmit` 通过。

## 实现记录

- 新增 `desktop/electron/services/videoRegistry.ts`：
  - registry 根目录为 `data/registry`；
  - 每个 UP 主一个文件：`data/registry/{up_id}.json`；
  - 合并策略是按 `bvid` upsert：API 返回的视频更新元数据，API 未返回的视频保留；
  - 本地 `status` 不被刷新覆盖；
  - 列表读取按 `pubdate`、`last_seen` 和 `bvid` 稳定排序。
- 更新 `desktop/electron/providers/sourceDiscovery.ts`：
  - 新增 `listRegisteredBilibiliSourceVideos`；
  - 正常刷新：API fetch → merge registry → read registry → return；
  - API 整体失败：read registry → return，并在 source error 中保留错误信息；
  - 后台来源发现也改用 registry 包装后的稳定列表。
- 更新 `desktop/electron/ipc/sourceIpcHandlers.ts` 和 `desktop/electron/main.ts`：
  - 前端 `sources:bilibili:videos` IPC 返回 registry 合并后的列表；
  - 主进程统一使用 `resolveVideoRegistryRoot(dataRoot)`。
- 新增 `desktop/scripts/check-video-registry-layer.mjs`：
  - 用临时目录验证 merge 不删历史、不重复、保留本地状态、API 失败可读旧列表；
  - 静态确认 UI IPC、后台发现和主进程装配已接入 registry。

## 验证结果

- `cd desktop && node --experimental-strip-types --no-warnings scripts/check-video-registry-layer.mjs`：通过。
- `cd desktop && node scripts/check-data-layer-normalization.mjs`：通过。
- `cd desktop && node scripts/check-subtitle-only-queue-mode.mjs`：通过；仅有既有 Node 模块类型警告。
- `cd desktop && node scripts/check-product-refactor-surface.mjs`：通过。
- `cd desktop && node --experimental-strip-types --no-warnings scripts/check-distill-progress.mjs`：通过。
- `cd desktop && npx tsc --noEmit`：通过。
- `python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py src\config.py src\wbi.py`：通过。

## 剩余边界

- 本轮没有启动软件、没有调用 B 站、没有运行真实队列。
- registry 中的 `status` 当前由本地合并保留，刷新不会覆盖；后续如要把 queued / processing / done 实时同步进 registry，应单独开小任务接入队列状态写回。
- 本轮不迁移旧数据，不修改 subtitle-only pipeline，不修改 UI 结构。

## 回退

回退新增 registry 服务、IPC 调用改动和检查脚本即可；不需要迁移或删除 `data/materials`。
