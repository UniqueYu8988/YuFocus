# 任务：长期成品库标题命名与已有材料迁移

创建日期：2026-07-01
状态：已完成

## 1. 目标

把长期成品库文件名从“日期 + 标题 + BV”改为“只保留标题”，并把视频发布时间写入文件属性的修改时间；同时把已有 `data/materials` 中已经生成的有价值内容按新规则同步到 `data/library`。

## 2. 用户需求总结

- 成品文件命名方式太长，应保留标题即可。
- 时间信息不要放在文件名中，而是写入文件属性：修改时间应尽量等于视频发布时间。
- 之前的 `materials` 文件管理也需要处理：已经生成的 NotebookLM 清洗稿和邮件稿，需要根据长期成品库规则迁移。

## 3. 本次范围

- 修改长期成品库命名规则：默认文件名为 `{视频标题}.md`。
- 标题做 Windows 文件名安全清洗，避免非法字符。
- 如果同一个 UP 文件夹下出现同名标题，使用 `标题 (2).md` 这类最小后缀防止覆盖，不主动把 BV 放进文件名。
- 文件修改时间优先使用视频发布时间；迁移历史材料时从 `data/registry/{up_id}.json` 查找 `pubdate / published_time`。
- 新增已有 `data/materials` 到 `data/library` 的同步迁移脚本。
- 实际运行迁移脚本，把现有有价值内容复制到 `data/library`。

## 4. 明确不做

- 不删除、移动或重命名 `data/materials` 下的任何真实材料。
- 不清理原始字幕、转写缓存、工作目录、运行状态或 manifest。
- 不改 NotebookLM 清洗稿正文、邮件稿正文、MiMo、本地 Ollama 或 SMTP 逻辑。
- 不把迁移做成数据库迁移，不引入新依赖。

## 5. 验收标准

- [x] 新生成成品文件名默认只保留标题。
- [x] 同名标题不会互相覆盖。
- [x] 成品文件修改时间能使用视频发布时间。
- [x] 已有 `materials` 中的 NotebookLM 清洗稿同步到 `data/library/notebooklm/{UP}/`。
- [x] 已有 `materials` 中的邮件稿同步到 `data/library/email/{UP}/`。
- [x] `data/library/index.json` 记录迁移结果并按 BV 去重。
- [x] 验证脚本确认迁移不删除 `data/materials`。
- [x] 类型检查和核心回归通过。

## 6. 风险

- 标题作为文件名可能出现同名冲突，需要最小后缀。
- 部分旧材料没有邮件稿或没有 registry 发布日期，这类材料只迁移存在的成品文件；缺失发布时间时不强行伪造。
- 文件属性修改时间可能被后续复制、网盘同步或压缩工具改变，因此索引仍保留 `publishedAt`。

## 7. 完成记录

完成时间：2026-07-01

- `libraryExportService` 命名规则已改为 `{视频标题}.md`；同一 UP 下同名冲突时使用 `标题 (2).md` 这类短后缀。
- BV 和发布时间不再塞进文件名，保存在 `data/library/index.json`；有发布时间时写入成品文件修改时间。
- 新增 `desktop/scripts/migrate-materials-to-library.mjs`，用于把现有 `data/materials` 中的有价值成品同步到长期成品库。
- dry-run 结果：扫描 196 个可迁移材料，预计导出 196 份 NotebookLM 清洗稿和 2 份邮件稿。
- 已执行真实迁移：`data/library/notebooklm` 生成 196 个 Markdown，`data/library/email` 生成 2 个 Markdown，`data/library/index.json` 为 196 条。
- 抽样验证：`BV1abJG66Ei8` 的成品文件名为 `【参考信息第614期】货车集体偏航泌阳；中学生手搓火箭.md`，修改时间为 `2026-06-15T12:10:15.000Z`，与 registry 发布时间一致。
- 数据安全：迁移前后 `data/materials` 目录数量均为 1779；脚本不包含删除调用。
