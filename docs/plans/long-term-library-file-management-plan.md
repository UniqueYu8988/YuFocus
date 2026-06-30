# 计划：长期资料库文件管理改造

创建日期：2026-07-01
状态：第一阶段已完成

## 1. 设计原则

- 成品库和工作区分离：`data/materials` 继续作为处理工作区，`data/library` 作为长期用户成品库。
- 第一阶段只复制 / 同步成品，不删除原材料。
- 成品文件应可脱离软件直接使用：能在资源管理器中浏览、排序、复制到 NotebookLM。
- 去重以 BV / sourceId 为核心，不依赖标题。
- 文件名服务用户阅读，索引服务软件长期稳定。

## 2. 阶段划分

### 阶段 1：非破坏性成品库

目标：完成长期成品库生成，不动旧材料包。

任务：

1. 新增 `desktop/electron/services/libraryExportService.ts`。
2. 从材料包读取：
   - `manifest.json`
   - `exports/notebooklm.md`
   - `delivery/email.md`
   - 必要时读取 `metrics.json` / `run_state.json`
3. 生成：
   - `data/library/notebooklm/{up}/...md`
   - `data/library/email/{up}/...md`
   - `data/library/index.json`
4. 设置成品文件修改时间：
   - 优先使用 `manifest.source.publishedAt` 或同等字段；
   - 再尝试 `pubdate` 秒级时间戳；
   - 拿不到则跳过。
5. 在队列完成材料包和本地消费层后调用同步服务。
6. 增加检查脚本。

### 阶段 2：历史材料补建

目标：为已有 `data/materials` 生成长期成品库。

任务：

1. 新增只读扫描脚本，先输出 dry-run 计划。
2. 确认旧材料包字段差异。
3. 小样本补建，不删除旧文件。
4. 再考虑全量补建。

### 阶段 3：安全清理工作区

目标：处理完成后减少单视频材料包体积。

前置条件：

1. 阶段 1 和 2 稳定。
2. 成品库和索引有自动验证。
3. 项目已有完整备份或可恢复方案。

候选保留：

- 长期成品库中的 NotebookLM 清洗稿和邮件稿。
- `data/library/index.json`。
- `data/registry/{up_id}.json`。
- 单视频轻量状态记录，例如 `manifest.json`、`metrics.json`、`run_state.json`。

候选清理：

- 下载的视频 / 音频临时文件。
- 切片音频。
- 可重新生成的缓存。
- 原始转写中间文件。

暂不清理：

- 还没成功同步到成品库的材料包。
- 失败、跳过、质量待复核材料。
- 无法确认来源 id 的材料。

## 3. 第一阶段文件结构

```text
data/library/
├── index.json
├── notebooklm/
│   └── 技术爬爬虾/
│       └── 2026-06-30 视频标题 [BVxxxx].md
└── email/
    └── 技术爬爬虾/
        └── 2026-06-30 视频标题 [BVxxxx].md
```

## 4. 索引结构草案

```json
{
  "version": 1,
  "updatedAt": "2026-07-01T00:00:00.000Z",
  "items": [
    {
      "bvid": "BV...",
      "sourceId": "BV...",
      "title": "视频标题",
      "sourceName": "UP 主",
      "sourceMid": "123",
      "publishedAt": "2026-06-30T12:00:00.000Z",
      "materialPath": "data/materials/123/bv...",
      "notebooklmPath": "data/library/notebooklm/UP/2026-06-30 标题 [BV...].md",
      "emailPath": "data/library/email/UP/2026-06-30 标题 [BV...].md",
      "exportedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

## 5. 验证计划

- 静态检查：确认新服务不会调用删除 API。
- 临时目录检查：构造一个假材料包，验证成品文件和索引生成。
- 文件名检查：非法字符、超长标题、重复标题、缺失 UP 名都能安全处理。
- 修改时间检查：有发布日期时 `mtime` 接近发布日期。
- 回归检查：`check-subtitle-only-queue-mode`、`check-fresh-email-delivery` 继续通过。
- 类型检查：`npx tsc --noEmit`。

## 6. 回退方式

- 第一阶段只新增 `data/library` 输出，不改变 `data/materials`，回退时删除新代码即可。
- 如果已经生成了 `data/library`，它是派生成品库；删除该目录不会影响原材料包。
- 第二、三阶段开始前必须重新确认备份和清理范围。
