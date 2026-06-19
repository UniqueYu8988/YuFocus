# BASELINE_ACCEPTANCE.md

记录旧项目改造前后都必须保持正常的核心行为。
不要把所有细节都写进来，只保留最关键的用户流程和数据安全检查。

## 1. 启动基线

- [x] 在 `desktop` 目录执行记录的启动方式后，桌面端能打开主窗口。
- [x] 主要入口可见：字幕流水线、NotebookLM 输出、流程、设置。
- [x] 设置页能打开；本轮未复制或展示 Cookie、API Key、SMTP 授权码等秘密值。
- [x] 启动时不会自动删除材料包、清空队列或重复加入大量任务。

### 2026-06-12 受控启动验收

- 结论：已在允许最小可逆写入的前提下短时间启动并关闭 Electron 桌面端。
- 启动前：工作台队列 53 项，全部为 `done`；`queued=0`，`processing=0`。
- 启动前历史背景：当时旧 `output/materials` 有 51 个 `.course_material` 测试材料包；该目录后来已按项目负责人确认删除，不再作为当前验收对象。
- 首页：可以打开，显示“今天从哪里开始”、继续阅读入口、制作入口和档案入口。
- 设置页：可以打开；未复制或输出秘密值；未点击刷新账号状态、邮件测试、TTS 或保存类按钮。
- 档案页：可以打开，但主档案区域显示“档案还是空的”，统计为 0；这与左侧档案计数 69、材料包 51 个不一致，保留为待核对现象。
- 材料列表：左侧“灵犀”来源区能显示已有来源和数量；展开 `TED官方精选` 后能看到多个已有精读稿条目。
- 灵犀：左侧灵犀来源区可读取现有内容；未找到明确的独立“灵犀页”导航入口，独立灵犀页未完成验收。
- 队列：关闭后仍为 53 项，全部 `done`；没有新增任务，没有自动执行任务。
- 材料数据：关闭后仍为 51 个材料包，最新材料包路径和修改时间不变，未发现新材料。
- 预期写入：`.shijie-focus-runtime.log` 增加；`.shijie-focus.window.json` 更新；`shijie-focus-secure.json` 修改时间更新但文件大小和 SHA1 哈希不变。
- 灵犀索引：当时旧 `output/knowledge/knowledge_library.json` 修改时间、大小和 SHA1 哈希均未变化；该旧测试输出后来已删除。
- 进程状态：验收后未发现残留 Electron 进程。

### 历史过程记录：启动前审计

受控启动前曾先做只读风险审计。审计确认：工作台队列 53 项且全部为 `done`，没有 `queued` 或 `processing`；后台自动化启动链路只设置下一次定时器，未发现启动即刻调用外部 API 的代码路径；如果队列中没有等待任务，启动时不会立刻制作或重新处理视频。

该审计同时确认桌面端启动不是严格只读：可能写入运行日志、窗口状态，前端加载队列时也可能写回 Electron Store。后续验收因此采用“允许最小可逆写入”的受控启动方式，并以上面的受控启动验收结果作为当前有效基线。

## 2. 核心用户流程

### 流程 1：读取当前材料包

- 人工验收步骤：打开桌面端，进入 NotebookLM 输出或字幕流水线，刷新材料列表。
- 预期结果：能看到 `data/materials/{up_id}/{video_id}` 下的现有材料包；至少显示标题、状态和 NotebookLM 清洗稿入口；不会改写或删除材料。
- 2026-06-20 结果：桌面端 IPC 能读取 `data/materials/256724889/bv131jf68e5n`，清空队列前后材料记录路径保持一致。
- 自动测试状态：未覆盖。

### 流程 2：B 站视频生成清洗稿

- 人工验收步骤：使用一个低风险样例 BV，在配置有效时启动制作。
- 预期结果：生成新的 `data/materials/{up_id}/{video_id}` 材料包，至少包含 `manifest.json`、`raw_transcript.txt`、`cleaned_transcript.txt`、`content.md`、`exports/notebooklm.md`、`run_state.json`；失败时错误提示可理解。
- 2026-06-20 结果：`BV131jF68E5n` 真实生成通过，核心文件齐全，`run_state` 为 `content_ready`，summary 为 `skipped`。

### 流程 3：来源去重和队列安全

- 人工验收步骤：保存关注来源，手动检查最近视频，再重复检查一次。
- 预期结果：同一 BV 不重复入队；队列并发不超过配置上限；关闭窗口后状态可恢复。
- 2026-06-20 结果：指定来源连续刷新后保持 30 条、30 个唯一 BV、0 重复；批量选择 2 条时加入队列按钮正确显示数量 2。

## 3. 数据安全

- [x] 使用正确输出根目录：默认 `C:\Users\Yu\AI\视界专注\data`。
- [x] 新材料只写入 `data/materials/{up_id}/{video_id}`。
- [x] UP 主视频列表刷新后，已有 `data/registry/{up_id}.json` 视频不会因为 API 临时缺失而消失。
- [x] `C:\Users\Yu\AppData\Roaming\视界专注\shijie-focus-secure.json` 仍然存在，且不公开内容。
- [x] 创建新材料后可以重新读取。
- [x] 重复检查来源不会生成意外重复队列或重复材料包。
- [x] 清空队列前有明确提示，且该操作只清队列记录、不删除材料包；单条删除材料仍需独立确认。
- [ ] 重要数据已有独立备份；当前仅确认存在若干 `shijie-focus-secure*.bak*`，尚未确认完整项目备份。

## 4. 页面或界面

- [ ] 制作台：输入 BV/链接、本地文件选择、制作进度、错误提示。
- [x] 视频来源：已有来源读取和指定来源刷新通过；本轮未修改来源收藏。
- [x] 任务队列：真实 subtitle-only 调度完成；清空与恢复队列回归通过。
- [x] 字幕流水线：首页和队列入口可见；未打开具体材料。
- [ ] NotebookLM 输出：能读取 `data/materials` 下的当前材料包。
- [x] 设置：设置页可打开；未测试保存、刷新状态、SMTP、TTS。

## 5. 自动验证

| 行为 | 测试位置 | 当前结果 |
|---|---|---|
| TypeScript 类型检查 | `desktop` 下 `npx tsc --noEmit` | 2026-06-20 通过 |
| Python 语法检查 | `python -m py_compile src\*.py` 指定核心文件 | 2026-06-20 通过 |
| 进度解析纯函数检查 | `desktop` 下 `node --experimental-strip-types --no-warnings scripts/check-distill-progress.mjs` | 2026-06-20 通过 |
| 视频注册表稳定性检查 | `desktop` 下 `node --experimental-strip-types --no-warnings scripts/check-video-registry-layer.mjs` | 2026-06-20 通过 |
| 清空队列数据保护 | `desktop` 下 `node --experimental-strip-types --no-warnings scripts/check-queue-clear-safety.mjs` | 2026-06-20 通过 |
| subtitle-only 主线检查 | `desktop` 下 `node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs` | 2026-06-20 通过 |
| Python 依赖探测 | `requests`、`jsonschema`、`PySide6`、`imageio_ffmpeg` | 2026-06-12 均已安装 |
| 完整桌面端启动 | 真实 Electron + CDP | 2026-06-20 通过并已关闭 |
| 受控桌面端启动 | 手工 + CDP 读取页面文本 | 2026-06-12 通过启动/关闭；档案主页面为空、独立灵犀页入口不明确仍属待核对现象 |
| B 站制作完整流程 | `BV131jF68E5n` | 2026-06-20 subtitle-only 通过 |
| 删除/清空队列保护 | 纯内存 + 真实 IPC | 2026-06-20 通过，材料未删除 |

## 6. 当前无法验证的事项

- Electron 主进程长期运行是否稳定。
- 未测试与当前主线无关的 MiniMax、SMTP 等外部服务。
- 后台自动化关闭窗口后是否继续运行。
- 队列恢复是否会重复加入任务。
- 单条删除档案、删除材料的完整真实数据回归仍未执行；清空队列保护已验证。
- NotebookLM 输出页对新 `data/materials` 材料包的完整读取仍需一次受控人工验收。

## 7. 最近一次人工验收

- 日期：2026-06-20
- 执行人：Codex 受控桌面回归
- 结果：注册表连续刷新稳定；批量选择入口正常；真实 subtitle-only 小样本生成到 `data`；清空队列不删除材料；应用已关闭。
