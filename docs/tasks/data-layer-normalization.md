# 任务：数据层标准化到单一 data 目录

创建日期：2026-06-16
状态：已完成

## 1. 目标

只规范数据路径和文件系统结构，不改 UI、不改队列执行逻辑、不改字幕获取和清洗算法。

目标主线：

```text
Video → Subtitle → Cleaning → data/materials/{up_id}/{video_id} → exports/notebooklm.md
```

## 2. 标准目录

```text
data/
├── materials/
├── temp/
├── cache/
├── logs/
└── legacy/
```

`data/materials/{up_id}/{video_id}` 是新的生产输出目录。

## 3. 不做

- 不移动、删除或改写现有真实 `output/` 数据。
- 不启动真实软件。
- 不运行真实队列。
- 不调用 B 站、MiMo、SenseVoice 或 Python 真实处理。
- 不修改 UI 行为。
- 不拆 `distiller.py`。

## 4. 发现和分类

| 路径 / 写入点 | 当前位置 | 分类 | 处理 |
|---|---|---|---|
| Python material package | `output/materials/*.course_material` | MATERIAL OUTPUT | 新写入改为 `data/materials/{up_id}/{video_id}` |
| NotebookLM export | `material/exports/notebooklm.md` | MATERIAL OUTPUT | 保留在 material 内，路径随 material root 迁移 |
| Python subtitle / transcript cache | `output/cache` | CACHE DATA | 改为 `data/cache` |
| Python local media work dir | `output/cache/local_media/*` | TEMP/CACHE | 改为 `data/temp/local_media/*` |
| Audio fallback cache | `output/cache/audio_fallback/*` | CACHE DATA | 改为 `data/cache/audio_fallback/*` |
| Electron runtime log | AppData `.shijie-focus-runtime.log` | LOG DATA | 新运行日志改为 `data/logs/runtime.log` |
| Electron Store | AppData secure store | APP STATE / SENSITIVE | 保留，不纳入本轮 `data`；不可泄露或删除 |
| Window state | AppData window state | APP STATE | 保留，不纳入本轮 `data` |
| Knowledge library | `output/knowledge` | LEGACY | 新路径改为 `data/legacy/knowledge`，旧数据只兼容读取 |
| Summary output | material `summary/*` | LEGACY | 不作为主线；保留旧材料兼容读取 |

## 5. 已实施修改

| 文件 | 修改 |
|---|---|
| `desktop/electron/runtime/runtimePaths.ts` | 默认生产根从 `output` 改为 `data`；运行日志改为 `data/logs/runtime.log`；旧 `output` 根加入 legacy root 规范化。 |
| `desktop/electron/runtime/backendRuntime.ts` | Python 子进程收到 `data` 根，不再收到 `data/materials`，避免 cache/temp 混入 materials。 |
| `desktop/electron/services/materialInventory.ts` | 材料扫描支持 `data/materials/{up_id}/{video_id}`，同时兼容旧 `.course_material`。 |
| `desktop/electron/services/knowledgeLibrary.ts` | 旧知识库新写入隔离到 `data/legacy/knowledge`。 |
| `src/config.py` | Python 默认输出根改为 `data`，并新增 `materials/temp/cache/logs/legacy` 子目录函数。 |
| `src/distiller.py` | 新材料包写入 `data/materials/{up_id}/{video_id}`；写出 `cleaned_transcript.txt`；cache 使用 `data/cache`；本地媒体中间文件使用 `data/temp/local_media`。 |
| `src/audio_fallback.py` | 音频预处理缓存使用 `data/cache/audio_prepare`；下载和切片工作目录使用 `data/temp/audio_prepare`。 |
| `desktop/scripts/check-data-layer-normalization.mjs` | 新增纯静态路径检查，不启动软件、不写真实数据。 |

## 6. 保留的安全例外

Electron Store、窗口状态和备份仍保留在 AppData。原因：

- 这些是应用状态和敏感配置，不是字幕生产输出；
- Electron Store 可能包含 Cookie、API Key、SMTP 授权码等秘密值；
- 本轮移动它们会带来登录、队列和配置丢失风险。

## 7. 未迁移的数据

- 未移动、删除或改写旧 `output/`。
- 未批量迁移旧 `.course_material`。
- 未触碰真实 AppData Store。

## 8. 验证

- `cd desktop && node scripts/check-data-layer-normalization.mjs`：通过。
- `cd desktop && node scripts/check-subtitle-only-queue-mode.mjs`：通过。
- `cd desktop && node --experimental-strip-types --no-warnings scripts/check-distill-progress.mjs`：通过。
- `cd desktop && node scripts/check-product-refactor-surface.mjs`：通过。
- `cd desktop && npx tsc --noEmit`：通过。
- `python -m py_compile src\config.py src\audio_fallback.py src\distiller.py`：通过。
- 受控合成端到端写出验证：通过。使用本地假字幕直接调用 Python 材料包写出函数，不联网、不启动软件、不调用 B 站/MiMo/SenseVoice；确认生成路径为 `data/materials/codex_validation_up/bv_codexdatalayervalidation`，核心文件齐全，随后删除该测试视频目录和空 UP 目录。
- 静态残留扫描：未发现正式代码或正式文档仍把 `output/notebooklm`、`output/cache`、`output/knowledge` 当作新路径。

本轮未启动软件、未运行真实队列、未调用 B 站、未调用 MiMo、未调用 SenseVoice。

## 9. 回退

回退本任务对路径解析、Python 输出目录函数和新增检查脚本的修改即可。不得删除真实 `data/` 或 `output/`。
