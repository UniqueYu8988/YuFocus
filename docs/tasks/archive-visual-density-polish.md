# 任务：档案页视觉密度优化

## 背景

档案页已经完成 UP 主分组和上下结构，但当前展示仍偏工程化：

- 头像角标像普通计数标签，和头像融合不足；
- 顶部数据栏数量过多；
- UP 主区和列表区各自有外框，视觉嵌套偏重；
- 资料列表里存在“阶段字幕清洗完成、原字、清洗、文稿、HTML、长稿”等低价值信息。

## 目标

- 头像数量角标改为更轻的半透明毛玻璃效果。
- 顶部统计只保留：总字数、占用、耗时、Token，并做成小巧指标。
- 融合 UP 主头像区和资料列表区，减少嵌套圆角矩形。
- 资料列表删除低价值标签，改为展示标题、BV/来源、更新时间、字数、占用、耗时和 Token 等有效信息。

## 不做

- 不改材料扫描、队列、后台同步和资料包数据结构。
- 不删除、移动或改写 `data/materials` 真实资料。
- 不改变档案页打开、复制路径、定位、删除等已有操作。

## 验收

- TypeScript 类型检查通过。
- 档案 UP 主分组检查继续通过。
- Git 空白检查通过。

## 完成记录

- 顶部统计栏已收敛为 4 项：总字数、占用、耗时、Token，并加上小图标。
- UP 主头像数量角标已改为半透明毛玻璃样式。
- UP 主头像条和资料列表已融合到同一个轻量容器中，减少嵌套外框。
- 资料列表已删除“阶段字幕清洗完成、原字、清洗、文稿、HTML、长稿”等低价值标签。
- 资料列表保留更有效的信息：标题、BV / 来源、更新时间、字数、占用、耗时、Token，以及打开 / 复制路径 / 定位 / 删除操作。

## 验证结果

- `cd desktop && node --experimental-strip-types --no-warnings scripts/check-archive-up-grouping.mjs`：通过。
- `cd desktop && npx tsc --noEmit`：通过。
- `cd desktop && node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs`：通过。
- `git diff --check -- desktop/src/ui/panels/workspace/ArchivePaneParts.tsx desktop/scripts/check-archive-up-grouping.mjs docs/tasks/archive-visual-density-polish.md`：通过，仅有 Windows 换行提示。
