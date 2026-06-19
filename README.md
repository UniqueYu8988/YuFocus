# 视界专注

视界专注是一个本地优先的桌面工具，用来把 B 站视频或本地音视频整理成可阅读、可保存、可导入 NotebookLM 的字幕清洗资料。

## 项目简介

本项目当前优先服务本机使用，不优先做多人协作或云端部署。

当前产品边界以 `PRODUCT.md` 为准；当前技术结构以 `ARCHITECTURE.md` 为准；当前状态和下一步以 `CURRENT_STATE.md` 为准。

## 当前核心能力

- B 站视频输入、字幕获取和字幕清洗。
- 本地视频或音频输入，本地转写作为无字幕兜底。
- 长视频和本地媒体的 NotebookLM 清洗稿出口。
- 任务队列、来源管理和基础后台能力。
- 设置和必要兼容层保留在项目中；精读、TTS、Obsidian、邮件、旧档案和旧灵犀不属于当前主线。

## 项目结构入口

- `AGENTS.md`：AI 工作入口、任务流程、文档职责和安全红线。
- `PRODUCT.md`：产品用途、功能边界和不可破坏行为。
- `ARCHITECTURE.md`：启动方式、技术结构、数据流、依赖和数据位置。
- `CURRENT_STATE.md`：当前阶段、已知风险、验证状态和下一步。
- `docs/BASELINE_ACCEPTANCE.md`：核心验收基线。
- `docs/plans/STABILIZATION_PLAN.md`：稳定化计划。
- `docs/VERIFICATION_BACKLOG.md`：待验证候选问题，不等同于当前 Bug。

## 环境准备

需要本机已安装：

- Node.js 和 npm；
- Python；
- 项目依赖，进入 `desktop` 后执行 `npm install`。

外部服务和本地转写配置在桌面端设置页维护。不要把 Cookie、API Key、SMTP 授权码等秘密值写入文档、日志或 Git。

## 启动方式

开发模式：

```powershell
cd desktop
npm run dev
```

注意：启动桌面端可能写入运行日志、窗口状态或 Electron Store 的正常状态数据。需要受控验收时，先阅读 `CURRENT_STATE.md` 和 `docs/BASELINE_ACCEPTANCE.md`。

## 基础验证

TypeScript 类型检查：

```powershell
cd desktop
npx tsc --noEmit
```

前端和 Electron 构建检查：

```powershell
cd desktop
npm run build:web
```

Python 语法检查：

```powershell
python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py
```

进度解析纯函数检查：

```powershell
cd desktop && node --experimental-strip-types --no-warnings scripts/check-distill-progress.mjs
```

视频注册表稳定性检查：

```powershell
cd desktop && node --experimental-strip-types --no-warnings scripts/check-video-registry-layer.mjs
```

## 数据与安全提示

重要数据位置：

- 默认数据根目录：`C:\Users\Yu\AI\视界专注\data`
- 当前生产材料包：`data/materials/{up_id}/{video_id}`
- UP 主视频注册表：`data/registry/{up_id}.json`
- NotebookLM 导入稿：`data/materials/{up_id}/{video_id}/exports/notebooklm.md`
- 遗留知识库：`data/legacy/knowledge/knowledge_library.json`
- Electron 用户数据目录：`C:\Users\Yu\AppData\Roaming\视界专注`
- Electron Store：`C:\Users\Yu\AppData\Roaming\视界专注\shijie-focus-secure.json`

安全原则：

- 不随意删除或移动 `data/materials` 下的资料。
- 不随意删除 `data/registry`，否则 UP 主历史视频列表会丢失。
- 不公开 Electron Store、备份文件或任何秘密值。
- 不把旧路线文档当作当前事实来源。
- 修改前先确认任务范围和相关验收。

## 当前状态

当前阶段、风险、下一步和暂停事项见：

```text
CURRENT_STATE.md
```
