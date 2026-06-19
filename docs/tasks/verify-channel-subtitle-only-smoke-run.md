# 任务：真实小样本 UP 主字幕清洗-only 受控试运行

创建日期：2026-06-15
状态：已完成（受控重试通过；发现数据状态异常，已停止继续运行）

## 1. 目标

用 1 个 UP 主来源中的 1 条短视频，验证当前 UP 主批量入队已经能走 `subtitle_only` 主线：

```text
UP 主视频列表
→ 勾选 1 条视频
→ 加入队列
→ 字幕获取 / 转写兜底
→ 字幕清洗
→ material package
→ exports/notebooklm.md
→ 完成
```

并确认不会触发精读稿、总结、邮件或 TTS。

## 2. 范围

只允许：

1. 启动软件；
2. 打开制作页 / 来源视频列表；
3. 选择 1 个已有 UP 主来源；
4. 选择 1 条短视频；
5. 加入队列；
6. 让它完成 `subtitle_only` 队列；
7. 检查资料包和 NotebookLM 稿是否生成。

## 3. 禁止

- 不选择多条视频。
- 不批量处理整个 UP 主。
- 不测试总结。
- 不测试邮件。
- 不测试 TTS。
- 不修改 `distiller.py`。
- 不迁移旧数据。
- 不改输出目录。
- 不处理 Git。
- 不做 UI 大改。
- 如果发现队列自动继续总结，立即停止并报告。

## 4. 运行前记录

- 记录时间：2026-06-15 18:29 左右。
- 当前队列数量：58。
- 当前队列状态：`queued=0`，`processing=0`，`done=54`，`failed=4`。
- 当前 `output/materials` 目录数量：52 个 `.course_material` 目录。
- 当前 material inventory 可识别资料包数量：51。
- 当前没有残留 Electron 进程。
- 运行日志路径：`C:\Users\Yu\AppData\Roaming\视界专注\.shijie-focus-runtime.log`。
- 预计输出目录：`C:\Users\Yu\AI\视界专注\output\materials`。
- 后台自动化：Store 中没有显式 `backgroundAutomationPaused` 字段；代码确认启动只会设置后台定时器，默认 6 小时后触发。运行前队列没有 `queued` 或 `processing` 项。

## 5. 测试视频

- 来源类型：已有收藏 UP 主来源。
- UP 主来源：`TED官方精选`。
- UP 主 MID：`256724889`。
- 视频标题：`3分钟看懂2026世界杯所有新规`。
- BV 号：`BV17pJ56pE3d`。
- 视频地址：`https://www.bilibili.com/video/BV17pJ56pE3d`。
- 时长：`03:09`，189 秒。
- 选择原因：从已有收藏来源读取最近视频，跳过已入队或已生成资料包的 BV，优先选择短视频。

## 6. 队列 item 字段

写入队列前通过项目 B 站来源读取代码重新确认该视频来自目标来源。新增队列项字段：

```json
{
  "queueId": "BV17pJ56pE3d-1781519365182-smoke",
  "bvid": "BV17pJ56pE3d",
  "title": "3分钟看懂2026世界杯所有新规",
  "sourceName": "TED官方精选",
  "queueSource": "follow_source",
  "editorialMode": "off",
  "pipelineMode": "subtitle_only",
  "status": "queued",
  "durationSeconds": 189,
  "durationText": "03:09"
}
```

软件启动后，队列调度将其置为处理并运行 material builder。最终队列项状态：

```json
{
  "status": "failed",
  "pipelineMode": "subtitle_only",
  "editorialMode": "off",
  "materialPath": "",
  "lastError": "材料整理失败：未找到可用的本地 SenseVoice 环境，请检查目录：C:\\Users\\Yu\\AI\\Cuda"
}
```

## 7. 首次运行结果

首次运行没有生成新的 material package。原因是该视频没有直接完成字幕清洗，进入本地转写兜底时失败：

```text
材料整理失败：未找到可用的本地 SenseVoice 环境，请检查目录：C:\Users\Yu\AI\Cuda
```

因此以下文件均未生成：

- `raw_transcript.txt`：未生成。
- `raw_tracks.json`：未生成。
- `content.md`：未生成。
- `exports/notebooklm.md`：未生成。
- `manifest.json`：未生成。
- `run_state.json`：未生成。

运行后 `output/materials` 目录数量仍为 52 个 `.course_material` 目录；未发现包含 `BV17pJ56pE3d` 的新资料包目录。

## 8. SenseVoice 路径修复与受控重试

用户提示此前移动过 SenseVoice 文件夹后，检查发现：

- Store 中原配置：`C:\Users\Yu\AI\Cuda`。
- 实际可用目录：`C:\Users\Yu\AI\Cuda\SenseVoice`。
- 实际存在脚本：`C:\Users\Yu\AI\Cuda\SenseVoice\local_audio_distiller.py`。
- 实际存在虚拟环境：`C:\Users\Yu\AI\Cuda\SenseVoice\.venv\Scripts\python.exe`。
- 项目侧 `local_audio_client.validate_local_engine()` 对新目录验证通过。

已将本机 Store 的 `runtimeSettings.local_transcription_root` 更新为：

```text
C:\Users\Yu\AI\Cuda\SenseVoice
```

随后只重置本次目标队列项 `BV17pJ56pE3d-1781519365182-smoke`，保持：

```json
{
  "pipelineMode": "subtitle_only",
  "editorialMode": "off",
  "status": "queued"
}
```

受控重试结果：

- 队列项最终状态：`done`。
- material path：`C:\Users\Yu\AI\视界专注\output\materials\3分钟看懂2026世界杯所有新规.course_material`。
- `run_state.json` 阶段：`content_ready`。
- `summary/summary_status.json`：`skipped`，原因是 summary 被禁用。

生成文件：

- `raw_transcript.txt`：已生成。
- `raw_tracks.json`：已生成。
- `content.md`：已生成。
- `exports/notebooklm.md`：已生成。
- `manifest.json`：已生成。
- `run_state.json`：已生成。

## 9. 日志检查

从本次启动后的运行日志检查：

- 出现 material builder：是。
- 出现 material summary：否。
- 出现 `editorial_summary` / `正在制作视频精读稿`：否。
- 出现邮件推送：否。
- 出现 TTS / speech 合成：否。

关键日志片段：

```text
workbench queue processing reason=queue-save queueId=BV17pJ56pE3d-1781519365182-smoke bvid=BV17pJ56pE3d
spawn material builder ... distiller.py ... BV17pJ56pE3d --result-json --material-only
distill-progress 8% 正在解析 B 站视频：BV17pJ56pE3d
distiller stderr 材料整理失败：未找到可用的本地 SenseVoice 环境，请检查目录：C:\Users\Yu\AI\Cuda
workbench queue item failed queueId=BV17pJ56pE3d-1781519365182-smoke message=材料整理失败：未找到可用的本地 SenseVoice 环境，请检查目录：C:\Users\Yu\AI\Cuda
```

没有发现 `spawn material summary`。

受控重试日志同样确认：

- 出现 material builder：是。
- 出现 material summary：否。
- 出现 `editorial_summary` / `正在制作视频精读稿`：否。
- 出现邮件推送：否。
- 出现 TTS / speech 合成：否。

## 10. 清空队列误操作记录

受控重试成功后检查到队列和材料目录数量明显减少。项目负责人随后确认，刚才可能误点击了“清空队列”。这与当前代码中的清空队列设计一致：

- 绿灯资料会收进档案。
- 黄灯和待处理资料会删除源文件。
- 队列会被清空，只保留仍在处理中的任务。

实际观察：

- 当前 Store 中 `workbenchQueue` 只剩 1 条，即本次 smoke 队列项。
- 当前 `output/materials` 下只看到 2 个 `.course_material` 目录。
- 任务开始前记录为：队列 58 条，`output/materials` 下 52 个 `.course_material` 目录，material inventory 可识别 51 个。
- 运行日志没有出现 material summary、邮件或 TTS。
- 回收站未看到 `.course_material` 目录。
- AppData 中现有 `shijie-focus-secure` 备份偏旧，旧格式未直接包含当前 `workbenchQueue` 字段，不能直接无脑恢复。
- 当前 `learningLibrary` 仍有 51 条记录，其中大量记录在本轮时间附近被更新，形态符合“清空工作台队列”后的归档状态。

处理决定：

- 已停止软件。
- 不继续启动软件。
- 不自动恢复、不迁移、不重建队列，除非项目负责人另开数据恢复任务。

## 11. 结论

本次字幕清洗-only 真实小样本主线验证通过，但伴随发现数据状态异常。

已确认成功的部分：

- 新增队列 item 是 `pipelineMode: 'subtitle_only'`。
- 新增队列 item 是 `editorialMode: 'off'`。
- SenseVoice 路径修复后，本地转写兜底可用。
- 队列只调用 material builder。
- 已生成 `raw_transcript.txt`、`raw_tracks.json`、`content.md`、`exports/notebooklm.md`、`manifest.json`、`run_state.json`。
- `run_state.json` 到达 `content_ready`。
- 没有触发 `runMaterialSummary()` 对应的 `spawn material summary` 日志。
- 没有触发精读稿、邮件或 TTS。
- 目标队列项最终为 `done`。

未完成或需另开任务确认的部分：

- 真实队列和 `output/materials` 数量在重试后异常变少。
- 需要先做数据恢复/队列清空来源排查，再继续任何真实运行。

## 12. 发现的问题与下一步

发现的问题：

- SenseVoice 被移动后，Store 中的 `local_transcription_root` 仍指向旧目录。
- 修复后 subtitle-only 小样本可完成。
- 当前真实 Store 和材料目录减少，已由项目负责人说明可能是误点击“清空队列”；该行为与现有代码设计一致，但数据影响较大。

下一步建议：

1. 不需要再把这次材料减少归因到 subtitle-only 链路。
2. 如需恢复旧队列或旧资料包，另开独立数据恢复任务。
3. 后续可单独做一个小任务：给“清空任务队列”增加更明确的数据影响提示或保护。
