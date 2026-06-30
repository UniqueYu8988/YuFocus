# 任务：队列与档案页 UI 密度优化

创建日期：2026-07-01
状态：已完成

## 1. 目标

优化队列和档案页的阅读体验：去掉队列双重滚轮，删除解释性副标题，重做档案 UP 头像区和资料列表布局，并把队列 / 档案列表改为每批最多 5 条的滚动加载。

## 2. 背景

便携版更新后，队列页出现页面滚动和列表内部滚动并存的问题。档案页当前外层圆角框、重复标题和选中态会占用较多空间，并且头像选中态存在裁切感。

## 3. 本次范围

- 队列页取消内部滚动容器，只保留页面主滚动。
- 队列页和档案页删除大标题下方解释性副标题。
- 队列列表初始最多 5 条，滚动到底部附近继续追加 5 条。
- 档案页删除最外层圆角矩形框和“UP 主”标题。
- 档案页首行直接显示 UP 头像，重做选中态为头像外圈 / 角标变色。
- 档案页删除“全部 / 196 份资料”等重复标题行。
- 档案资料列表去掉外部大框，逐条顺序排列，初始最多 5 条，滚动继续加载。

## 4. 明确不做

- 不修改字幕清洗、队列执行、模型调用、邮件发送逻辑。
- 不删除、迁移或改写 `data/materials` 真实资料。
- 不读取或输出 Cookie、API Key、SMTP 授权码等秘密值。
- 不重构 `WorkspacePane.tsx` 大文件，只做本次 UI 所需的小步改动。

## 5. 验收标准

- [ ] 队列页不再有双重滚轮。
- [ ] 队列和档案页标题下没有解释性副标题。
- [ ] 队列和档案列表每批最多加载 5 条。
- [ ] 档案页首行直接显示 UP 头像，没有外层大圆角框和“UP 主”标题。
- [ ] 档案头像选中态不裁切。
- [ ] 档案页没有重复的“全部 / X 份资料”标题行。
- [ ] 相关检查、类型检查和便携版冒烟验证通过。

## 6. 相关文件和数据

- `desktop/src/ui/pages/WorkspacePane.tsx`
- `desktop/src/ui/pages/WorkspacePaneUtils.ts`
- `desktop/src/ui/panels/workspace/WorkbenchQueueParts.tsx`
- `desktop/src/ui/panels/workspace/ArchivePaneParts.tsx`
- `desktop/scripts/check-queue-record-feed.mjs`
- `desktop/scripts/check-archive-up-grouping.mjs`

## 7. 风险

- 滚动加载如果触发过早或过晚，会影响列表浏览体验；保留“继续加载”按钮作为兜底。
- 档案页只是 UI 呈现调整，不改变真实资料扫描和分组逻辑。

## 8. 验证方式

- 自动测试：更新队列与档案 UI 检查脚本。
- 构建或类型检查：`npx tsc --noEmit`。
- 打包验收：`npm run build:portable` 和打包版 smoke test。

## 9. 完成记录

2026-07-01 完成。

- 队列页取消内部滚动容器，改为页面主滚动底部哨兵触发加载，避免双重滚轮。
- 队列页标题下方解释性副标题已删除。
- 队列记录批次从 10 条改为 5 条；只有用户向下滚动后才会追加下一批，保留“继续加载”按钮兜底。
- 档案页删除最外层大圆角框和“UP 主”标题，首行直接显示 UP 头像。
- 档案头像选中态改为紧贴头像的彩色圆形外圈和角标变色，避免选中状态裁切。
- 档案页删除重复的“全部 / X 份资料 / 最近更新时间”标题行。
- 档案资料列表改为无外层大框的顺序列表，批次同样为 5 条，滚动后继续加载。
- 已重新生成便携版 `desktop/release/视界专注_v0.1.0_x64.exe` 和分享包。

验证：

- `node scripts/check-queue-record-feed.mjs`
- `node scripts/check-archive-up-grouping.mjs`
- `node scripts/check-folded-queue-issues.mjs`
- `node scripts/check-efficiency-observability.mjs`
- `node desktop/scripts/check-home-dashboard-safety.mjs`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `npx tsc --noEmit`
- `npm run build:portable`
- `node desktop/scripts/check-packaged-portable-smoke.mjs`
