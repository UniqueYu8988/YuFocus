# 任务：保护进度解析纯函数

创建日期：2026-06-12
状态：已完成

## 1. 目标

确认并保护 `desktop/src/lib/distillProgress.ts` 当前进度数据的解析、转换、显示文案和异常输入处理行为。

本任务只增加或加强验证，不改变正常用户可观察行为。

## 2. 背景

`distillProgress.ts` 是代码风险审计中标出的低风险纯函数模块。它位于前端，不读写文件，不访问网络，不调用 Electron、Python、MiMo、邮件、TTS 或真实材料数据。

## 3. 开始前分析

### 当前负责什么

- 定义整理进度阶段类型 `DistillStage`。
- 将 `stageTimings.total_seconds` 格式化为“本次整理耗时约 X 秒/分钟”。
- 将 Python / Electron 进度回调 payload 转成前端 store 使用的 `DistillProgressSnapshot`。
- 将内部阶段名转成中文显示文案，例如 `metadata -> 解析视频`、`subtitle -> 抓取字幕`、`complete -> 资料完成`。

### 输入来源

- Python 整理链路通过标准输出发出进度信息。
- Electron 主进程解析后经 `window.desktopAPI.onDistillProgress()` 推给前端。
- `desktop/src/store.ts` 在回调中调用 `buildDistillProgressSnapshot(payload)`，并另外保存 `payload.percent`。

### 是否为纯函数模块

是。该模块只做字符串、数字和布尔值转换，不读写真实数据，不访问网络，不依赖时间或随机数。

### 当前边界情况

- 未知阶段名会显示为 `unknown / 处理中`。
- `cacheHint === "material_package"` 会优先显示为 `复用资料包`。
- 缺少 message 时使用默认文案。
- 缺少数字字段时默认 0。
- 缺少 resumed 时默认 false。
- `formatDistillTimingSummary()` 对缺失、0、负数、非数字返回空字符串。
- 运行时若传入 `undefined` payload、非字符串 stage 或非有限数字，旧实现不够稳；这些不是正常路径，但属于异常输入保护范围。

### 当前测试保护

- 没有现成前端单元测试框架。
- 当前只有 TypeScript 类型检查和少量脚本级检查。

### 本次准备保护的现有行为

- 正常阶段和中文标签。
- 复用资料包文案。
- 缺失字段默认值。
- 空值、未知阶段、非法数字安全处理。
- 完成、失败、等待等非当前阶段名统一归为 `unknown / 处理中`。
- 耗时显示的秒/分钟转换。
- 检查脚本完全使用内存样例，不访问真实数据。

## 4. 本次范围

- 新增最小纯内存检查脚本。
- 必要时对 `desktop/src/lib/distillProgress.ts` 做低风险异常输入保护。
- 更新本任务文件。
- 按实际情况更新 `CURRENT_STATE.md`。

## 5. 明确不做

- 不启动软件。
- 不修改队列数据。
- 不读取或修改 AppData。
- 不读取真实材料包。
- 不调用 Python、MiMo、邮件、TTS 或外部 API。
- 不修改 `WorkspacePane.tsx`。
- 不修改 `distiller.py`。
- 不改变界面设计。
- 不进行无关重构。
- 不更新依赖。

## 6. 验收标准

- [x] 正常样例通过。
- [x] 至少一个异常输入样例被正确处理。
- [x] 测试或检查完全使用内存数据。
- [x] `npx tsc --noEmit` 通过。
- [x] 确认没有真实数据访问和网络访问。
- [x] 文件差异没有无关修改。

## 7. 相关文件和数据

- `desktop/src/lib/distillProgress.ts`
- `desktop/src/store.ts`（只读调用点）
- `desktop/scripts/check-distill-progress.mjs`
- `CURRENT_STATE.md`

不涉及真实材料包、Electron Store、AppData、队列或外部服务。

## 8. 风险

- 检查脚本如果依赖过多内部细节，未来文案微调会导致测试过脆。
- 如果为了测试去改变正常进度语义，会影响用户看到的状态文案；本任务避免改变正常输入行为。
- Node 直接执行 `.ts` 模块依赖当前 Node 版本的 TypeScript 类型擦除能力，因此检查命令需要明确使用 `--experimental-strip-types`。

## 9. 验证方式

- `node --experimental-strip-types --no-warnings scripts/check-distill-progress.mjs`
- `npx tsc --noEmit`
- 静态搜索检查脚本和模块是否包含网络、文件、真实数据路径访问标记。
- Git diff 检查。

## 10. 完成记录

已完成。

### 修改内容

- 新增 `desktop/scripts/check-distill-progress.mjs`，使用 Node 内置 `assert` 做纯内存检查，不引入依赖。
- 对 `desktop/src/lib/distillProgress.ts` 做最小异常输入保护：
  - `buildDistillProgressSnapshot()` 允许 `undefined`、`null` 或不完整 payload，统一落到默认快照；
  - 非字符串 `stage` 不再抛错，统一归为 `unknown`；
  - `NaN`、`Infinity` 等非有限数字统一归 0；
  - 正常阶段、正常文案、`cacheHint === "material_package"`、负数和超范围数字的既有语义保持不变。

### 覆盖行为

- 正常进度值：`subtitle`、message、音频/分块计数、resumed。
- 缺少字段：默认 message、数字 0、resumed false。
- 空值或 undefined：安全返回 `unknown / 处理中`。
- 非法数字：`NaN`、`Infinity`、非数字字符串归 0。
- 超出正常范围数值：保持当前语义，不额外裁剪。
- 已完成、失败、等待等状态：`complete` 显示 `资料完成`；`failed`、`waiting` 不是当前合法阶段，归为 `unknown / 处理中`。
- 显示文本转换：覆盖全部当前合法阶段标签。
- 不同阶段名称兼容：阶段名前后空格会被 trim。
- 耗时文本：覆盖空值、负数、秒、分钟边界。

说明：百分比转换不在 `distillProgress.ts` 内，而是在 `desktop/src/store.ts` 和页面组件中处理；本任务未修改该路径。

### 验证结果

- `node --experimental-strip-types --no-warnings scripts/check-distill-progress.mjs`：通过。
- `npx tsc --noEmit`：通过。
- 静态搜索脚本和模块：未发现网络、文件读写、真实材料路径、AppData、Electron Store 或 `.course_material` 访问标记。
- 未启动软件。
- 未读取或修改真实材料包、队列、AppData、Electron Store。
- 未调用 Python、MiMo、邮件、TTS 或外部 API。

### 回退方式

- 删除 `desktop/scripts/check-distill-progress.mjs`。
- 回退 `desktop/src/lib/distillProgress.ts` 的本次异常输入兜底。
- 回退本任务文件和 `CURRENT_STATE.md` 中对应状态记录。

### 模板价值

适合作为后续纯函数模块保护的轻量模板：一个独立检查脚本、内存样例、无依赖、配合 `tsc --noEmit`。
