# 任务：字幕清洗默认切换为非 Pro MiMo 模型

## 背景

MiMo Token Plan 控制台显示已消耗约 8.37 亿 Credits。只读核验发现，本地 `metrics.json` 记录的原始 token 约 180 万；按 `mimo-v2.5-pro` 的 Credit 倍率估算，正好接近控制台消耗。当前软件主用途只是字幕清洗，不需要默认使用 Pro 模型。

## 目标

- 字幕清洗默认模型改为 `mimo-v2.5`。
- 设置页不再默认引导选择 `mimo-v2.5-pro`。
- 如果旧设置中保存了 `mimo-v2.5-pro`，加载时自动降级为 `mimo-v2.5`。
- 后台 Python 运行环境的 MiMo 清洗模型也使用 `mimo-v2.5`。

## 不做

- 不读取、输出或改写 MiMo API Key。
- 不删除已有材料包和 metrics。
- 不改变 MiMo endpoint。
- 不修改字幕清洗提示词和分块策略。

## 验收

- 静态检查确认 UI 默认、主进程默认、浏览器 fallback 默认和 Python 运行兜底均为 `mimo-v2.5`。
- TypeScript 类型检查通过。

## 完成记录

- 运行设置默认值已从 `mimo-v2.5-pro` 改为 `mimo-v2.5`。
- 旧设置中保存的 `mimo-v2.5-pro` 会在加载时自动降级为 `mimo-v2.5`。
- 后台传给 Python 的 `SHIJIE_MIMO_CLEANING_MODEL` 会防止旧 Pro 值继续透传。
- 设置页候选模型已只保留 `mimo-v2.5`。
- 新增 `desktop/scripts/check-mimo-non-pro-default.mjs` 防止 Pro 默认值回流。
