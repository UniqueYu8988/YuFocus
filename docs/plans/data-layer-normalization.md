# 计划：数据层标准化到单一 data 目录

## 当前情况

项目主线已经收束为：

```text
UP 主 → Video → Subtitle → Cleaning → NotebookLM Output
```

但代码和文档中仍存在旧 `output/` 根目录、`.course_material` 单层材料包、AppData 运行日志、`output/knowledge` 等历史路径描述。

## 目标

把新的生产输出、缓存、临时文件和运行日志统一到：

```text
data/
├── materials/
├── temp/
├── cache/
├── logs/
└── legacy/
```

新的生产输出唯一落点为：

```text
data/materials/{up_id}/{video_id}/
```

## 明确不做

- 不移动、删除、改写现有真实 `output/` 数据。
- 不启动软件。
- 不运行真实队列。
- 不调用 B 站、MiMo、SenseVoice 或 Python 真实处理。
- 不修改 UI。
- 不修改队列执行语义。
- 不拆分 `src/distiller.py`。
- 不迁移 Electron Store 中的敏感设置。

## 相关模块与数据

| 模块 | 作用 | 本轮处理 |
|---|---|---|
| `desktop/electron/runtime/runtimePaths.ts` | Electron 默认数据根、日志路径和旧路径规范化 | 改默认根和日志落点 |
| `desktop/electron/runtime/backendRuntime.ts` | 调用 Python 时注入环境变量 | 传 `data` 根，不传 `data/materials` |
| `desktop/electron/services/materialInventory.ts` | 扫描材料包 | 同时识别新两层目录和旧 `.course_material` |
| `desktop/electron/services/knowledgeLibrary.ts` | 旧知识库索引 | 新写入隔离到 `data/legacy/knowledge` |
| `src/config.py` | Python 数据根和子目录 | 新增 `materials/temp/cache/logs/legacy` 辅助函数 |
| `src/distiller.py` | 字幕清洗和材料包写入 | 新材料包写到 `{up_id}/{video_id}` |
| `src/audio_fallback.py` | 音频转写兜底缓存和临时文件 | 缓存到 `data/cache`，下载/切片到 `data/temp` |

## 分阶段步骤

### 阶段 1：路径发现和分类

- 修改：只记录发现，不改真实数据。
- 验证：静态搜索 `writeFile`、`output`、`cache`、`notebooklm` 等写入点。
- 完成标准：任务文件中列出路径分类。
- 回退：无代码变更。

### 阶段 2：路径标准化

- 修改：只改默认路径、材料包落点、缓存/临时/日志路径。
- 验证：TypeScript、Python 语法检查和纯静态路径检查。
- 完成标准：新写入默认进入 `data/*`，旧 `output/` 不再作为默认生产根。
- 回退：恢复本轮路径函数和环境变量传递。

### 阶段 3：文档收敛

- 修改：同步 `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 和任务文件。
- 验证：检查正式文档不再把 `output/notebooklm` 写成当前主出口。
- 完成标准：文档与代码一致。
- 回退：恢复文档原描述。

## 风险

| 风险 | 影响 | 处理方式 |
|---|---|---|
| 误移动旧 `output/` 真实资料 | 数据丢失 | 本轮不移动、不删除旧数据 |
| Python 收到 `data/materials` 而不是 `data` 根 | cache/temp 混入生产材料目录 | Electron 调用 Python 时只传 `data` 根 |
| 新两层材料目录无法被扫描 | 输出页看不到新材料 | 材料扫描同时支持新旧结构 |
| 敏感设置被迁移到普通数据目录 | Cookie/API Key 泄露风险 | Electron Store 保留在 AppData，不纳入本轮迁移 |

## 依赖变化

无新增依赖。

## 数据与备份

本轮不迁移真实数据。旧 `output/` 作为历史数据保留，不删除、不覆盖。

Electron Store 和窗口状态仍保留在 AppData，因为它们是应用状态和敏感配置，不是字幕生产输出。

## 完成定义

- 新生产输出路径为 `data/materials/{up_id}/{video_id}`。
- `exports/notebooklm.md` 位于每个材料包内部。
- Python cache 写入 `data/cache`。
- Python temp 写入 `data/temp`。
- Electron 运行日志写入 `data/logs/runtime.log`。
- 旧知识库新写入隔离到 `data/legacy/knowledge`。
- TypeScript、Python 语法检查和纯静态路径检查通过。
