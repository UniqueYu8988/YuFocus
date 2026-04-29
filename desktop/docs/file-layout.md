# 视界专注文件布局

当前 MVP 只保留一个正式输出根目录：

```text
C:\Users\Yu\AI\视界专注\output\
```

推荐结构：

```text
output/
  materials/
    xxx.course_material/
      manifest.json
      raw_transcript.txt
      blocks/
      indexes/
      codex_tasks/
      course_draft/
        lessons/
        final.course-package.json
  courses/
    imported-or-manual-final.course-package.json
  99_legacy/
    duplicate_materials/
    old_course_packages/
    loose_artifacts/
    test_runs/
    old_numbered_layout/
    legacy_output_roots/
  cache/
```

规则：

- `materials` 放可复用的 Codex 原材料包，是课程制作链路的核心资产。
- `courses` 放手动整理或临时导入的最终课包；从原材料包生成的最终课包优先保留在对应 `course_material/course_draft/` 内。
- `99_legacy` 只放历史迁移或重复材料，正常工作台不主动读取。
- `cache` 是字幕、音频、转写等运行缓存，默认保留；确认无需复用后再单独清理。
- `desktop/release/output`、`desktop/output` 属于旧路径，软件会自动回到正式 `output` 根目录。
- 压力测试目录、旧编号目录、零散日志和旧报告会归档到 `99_legacy`，不再散落在正式根目录。
- `desktop/release/output` 和 `desktop/output` 的旧运行数据会整体归档到 `99_legacy/legacy_output_roots`。

整理命令：

```powershell
cd C:\Users\Yu\AI\视界专注\desktop
npm run output:plan
npm run output:organize
node .\scripts\organize-output.mjs --apply --delete-old-course-packages
```

`output:plan` 只演练，不移动或删除文件。`output:organize` 会把可复用材料搬到 `materials`，把旧课包归档到 `99_legacy/old_course_packages`。最后一条命令会直接删除旧课包，执行前必须确认。
