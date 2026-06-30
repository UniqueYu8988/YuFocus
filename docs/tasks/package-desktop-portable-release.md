# 任务：桌面便携版和安装包体验优化

创建日期：2026-06-30
状态：已完成（第一版便携版落地；安装包阶段暂缓）

## 1. 目标

把“视界专注”从每次依赖源码命令启动，逐步优化为普通用户可以双击启动的软件形态。

第一目标是 Windows 便携版：生成一个可双击运行的 exe，并确认它能读取现有设置、打开核心页面、识别运行环境。第二目标是在便携版稳定后，再评估是否增加传统安装包。

## 2. 背景

当前项目已经有 Electron 打包基础：

- `desktop/package.json` 已配置 `electron-builder`；
- 已有 `build:portable` 脚本；
- 打包配置会把 `src` Python 后端作为 `resources/backend` 带入；
- 主进程已经有 packaged 分支，会把后端脚本同步到用户数据目录后运行。

主要不确定点不是 Electron 本体，而是外部运行环境：

- Python 解释器和依赖是否可用；
- 本地 SenseVoice / CUDA 环境是否可用；
- Ollama 是否运行，且是否已有 `shijie-qwen3-8b-q4-chat`；
- MiMo、B 站 Cookie、SMTP 配置是否仍能安全读取；
- 打包后数据根、设置文件和真实材料目录是否保持清楚。

## 3. 本次范围

- 评估并修正便携版打包启动路径。
- 优先生成 Windows x64 便携版 exe。
- 保持外部模型按需调用：软件启动时不加载 SenseVoice 或 Ollama；只有处理视频或生成本地 brief 时才调用。
- 增加或补强运行环境自检，帮助用户判断 Python、SenseVoice、Ollama、MiMo、B 站 Cookie、SMTP 是否可用。
- 明确打包版数据根和设置根，不自动迁移、不删除、不改写真实 `data/materials`。
- 增加最小验收脚本或文档，覆盖打包产物、核心页面、队列安全和外部模型按需调用。

## 4. 明确不做

- 不把 SenseVoice、CUDA、Ollama 或 Qwen3 模型打进第一版安装包。
- 不内置或提交 B 站 Cookie、MiMo Key、SMTP 授权码等秘密值。
- 不批量处理真实视频，不批量重跑 `data/materials`。
- 不自动迁移、删除、移动或重命名真实资料。
- 不更换 Electron、React、Python 框架。
- 不先做大而全的安装器；便携版验收通过后再决定是否做 NSIS 安装包。

## 5. 验收标准

- [x] 能运行 `npm run build:portable` 并生成 Windows x64 便携版 exe。
- [x] 双击便携版可以打开主窗口。
- [x] 打包版默认不会因为启动而下载、转写、清洗或发送邮件。
- [x] 打包版可以打开“最近 / 队列 / 档案 / 流程 / 设置”核心页面。
- [x] 打包版能找到 Python 后端脚本，或者给出清楚错误提示。
- [x] 环境自检能显示 Python、Python 依赖、本地 SenseVoice、Ollama、本地模型、MiMo、B 站 Cookie、SMTP 的可用状态。
- [x] 外部模型保持按需调用：启动和普通浏览页面不调用 SenseVoice、Ollama、MiMo 或 SMTP。
- [x] 真实数据目录不被迁移、删除或改写；构建只写 `desktop/dist`、`desktop/dist-electron`、`desktop/release` 等构建产物。
- [x] TypeScript、关键静态检查和 Python 语法检查通过。

## 6. 相关文件和数据

- `desktop/package.json`
- `desktop/scripts/prepare-release.ps1`
- `desktop/scripts/package-share.ps1`
- `desktop/electron/runtime/runtimePaths.ts`
- `desktop/electron/runtime/backendRuntime.ts`
- `desktop/electron/runtime/settings.ts`
- `desktop/electron/services/localOllamaAdapter.ts`
- `src/local_audio_client.py`
- `src/config.py`
- `requirements.txt`
- `data/materials`
- `data/registry`
- `C:\Users\Yu\AppData\Roaming\视界专注\shijie-focus-secure.json`

## 7. 风险

| 风险 | 影响 | 临时处理 |
|---|---|---|
| 打包版找不到 Python | 无法生成资料 | 第一版先检测并提示，不内置 Python |
| Python 依赖缺失 | 字幕获取或转写失败 | 环境自检列出缺失项 |
| SenseVoice / CUDA 环境不匹配 | 无字幕视频无法转写 | 保持外部配置，按需调用，失败不影响浏览 |
| Ollama 未运行或模型不存在 | 本地 brief / 邮件草稿失败 | 本地消费层标记失败或需配置，不让 NotebookLM 主资料失败 |
| 打包后数据根混乱 | 找不到旧材料或写到错误位置 | 第一版不自动迁移数据，先明确显示当前数据根 |
| 构建命令重写产物 | 产生大量构建文件 | 构建产物不进入真实资料目录，完成后检查 Git diff |

## 8. 验证方式

- 自动测试：
  - `npx tsc --noEmit`
  - `python -m py_compile src/distiller.py src/bilibili_api.py src/local_audio_client.py src/config.py`
  - `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
  - `node desktop/scripts/check-product-refactor-surface.mjs`
  - `node desktop/scripts/check-home-dashboard-safety.mjs`
- 构建验证：
  - `npm run build:portable`
- 人工验收：
  - 双击便携版 exe；
  - 打开最近、队列、档案、流程、设置；
  - 查看环境自检状态；
  - 确认启动后没有自动处理视频或发送邮件。

## 9. 完成记录

### 2026-06-30：阶段 1-3 首轮完成

已完成：

- `npm run build:portable` 成功，生成：
  - `desktop/release/视界专注_v0.1.0_x64.exe`
  - `desktop/release/视界专注_v0.1.0_share.zip`
- 便携版 exe 受控启动成功。通过临时 `--user-data-dir` 和远程调试端口确认：
  - Electron / Chrome 调试端口可连接；
  - 页面标题为“视界专注”；
  - 页面 URL 来自 portable 解压目录中的 `resources/app.asar/dist/index.html`。
- 新增运行环境自检：
  - 主进程服务：`desktop/electron/services/environmentCheckService.ts`
  - IPC：`settings:environment-check`
  - preload：`window.desktopAPI.runEnvironmentCheck`
  - 设置页区块：“运行环境自检”
- 自检覆盖：
  - 内置后端脚本；
  - Python；
  - Python 依赖；
  - 本地 SenseVoice 目录结构；
  - Ollama 和目标模型；
  - MiMo Key 是否配置；
  - B 站 SESSDATA 是否配置；
  - SMTP 是否配置完整。
- 自检保持按需原则：
  - Python 依赖只用 `importlib.util.find_spec` 探测；
  - SenseVoice 只检查目录、入口脚本和 Python，不加载模型；
  - Ollama 只读取 `/api/tags`，不生成文本；
  - MiMo / SMTP 只判断是否配置，不发请求。

验证结果：

- `npm run build:portable` 通过。
- `node desktop/scripts/check-packaged-environment-check.mjs` 通过。
- `npx tsc --noEmit` 通过。
- `python -m py_compile src/distiller.py src/bilibili_api.py src/local_audio_client.py src/config.py` 通过。
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs` 通过。
- `node desktop/scripts/check-product-refactor-surface.mjs` 通过。
- `node desktop/scripts/check-home-dashboard-safety.mjs` 通过。
- 打包版启动日志只出现 `createWindow` 和空闲检查；未发现 `ollama`、`mimo`、`smtp`、`email`、`SenseVoice`、`transcribe`、`distiller` 或 `spawn` 调用痕迹。

### 2026-06-30：打包版核心页面验收完成

已完成：

- 新增 `desktop/scripts/check-packaged-portable-smoke.mjs`，自动启动最新便携 exe，连接远程调试端口，点击“最近 / 队列 / 档案 / 流程 / 设置”，并在设置页调用环境自检。
- 脚本确认页面标题为“视界专注”，环境自检返回 `backend_scripts`、`python`、`python_dependencies`、`sensevoice`、`ollama`、`mimo`、`bilibili_cookie`、`smtp`。
- 脚本检查启动日志新增部分，确认没有模型、转写、MiMo、Ollama、SMTP、邮件或 distiller 调用痕迹。

最终验证：

- `npm run build:portable` 通过。
- `node desktop/scripts/check-packaged-portable-smoke.mjs` 通过。
- `node desktop/scripts/check-packaged-environment-check.mjs` 通过。
- `npx tsc --noEmit` 通过。
- `python -m py_compile src/distiller.py src/bilibili_api.py src/local_audio_client.py src/config.py` 通过。
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs` 通过。
- `node desktop/scripts/check-product-refactor-surface.mjs` 通过。
- `node desktop/scripts/check-home-dashboard-safety.mjs` 通过。

安装包结论：

- 第一版不进入 NSIS 安装包阶段。
- 原因：当前项目仍依赖外部 Python、SenseVoice、Ollama 和本地模型环境；便携版已经满足“双击启动”和分享使用，风险更低。
- 后续如果需要传统安装器，应另开任务，只安装软件本体，不内置模型，不删除用户数据。
