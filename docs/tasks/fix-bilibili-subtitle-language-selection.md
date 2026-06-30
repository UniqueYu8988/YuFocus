# 任务：修复 B 站多语言字幕误合并

## 背景

真实材料包 `data/materials/316183842/bv1kk9kbaejv` 的 NotebookLM 导入稿出现“多版字幕”现象。只读核验发现该视频同时存在中文 `ai-zh` 和英文 `ai-en` 字幕轨道，当前代码把两条轨道都合并进正文清洗，导致最终稿混入英文整轨字幕。

## 目标

- 同一个视频分 P 有多条语言字幕时，正文只使用一条最佳字幕轨道。
- 默认优先中文；只有没有中文时才使用英文；再没有英文时使用第一条可用字幕。
- 避免中英两套完整字幕同时进入 `raw_transcript.txt`、`content.md` 和 `exports/notebooklm.md`。
- 保持多分 P 合并能力：多个分 P 仍可按分 P 合并，但每个分 P 内只选一条语言轨。

## 不做

- 不删除、移动或覆盖已有 `data/materials` 真实资料包。
- 不重跑大量历史视频。
- 不修改队列、自动同步、UI 或 NotebookLM 文件格式。
- 不调整 MiMo 清洗提示词和长文本分块策略。

## 风险

- 如果某些视频只有英文字幕，仍需要能正常使用英文兜底。
- 如果字幕语言标记不规范，需要保留“没有中文/英文时取第一条”的兜底。
- 已经生成的旧材料包不会自动修复，需要后续手动或队列重跑该 BV 才会得到新产物。

## 验收

- 新增检查覆盖“中文 + 英文同时存在时只选中文”。
- 覆盖“只有英文时选英文”。
- 覆盖“没有中英文时选第一条可用字幕”。
- Python 语法检查通过。

## 完成记录

- `src/bilibili_api.py` 的字幕选择逻辑已改为单轨策略。
- 新增 `desktop/scripts/check-subtitle-language-selection.mjs`，用内存样本验证中英双轨不会同时进入正文。
- 验证通过：
  - `node desktop/scripts/check-subtitle-language-selection.mjs`
  - `python -m py_compile src/bilibili_api.py`
