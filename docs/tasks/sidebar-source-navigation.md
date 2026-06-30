# 侧边栏视频来源导航

状态：已完成

## 目标

把首页中的视频来源选择移到左侧栏：左侧栏显示“最近”和固定 UP 列表；点击 UP 后，右侧显示该 UP 的视频列表。

## 范围

- 将主导航“首页”改名为“最近”。
- 在侧边栏新增固定 UP 来源列表，显示头像和名称。
- 点击侧边栏 UP 后，右侧显示该 UP 的视频列表，并保留“加入队列”能力。
- 将固定 UP 管理入口移到侧边栏来源区。
- 首页右侧不再显示独立的视频来源选择板块。

## 不做

- 不改变注册表路径和刷新逻辑。
- 不自动下载、转写或制作资料。
- 不改变任务队列执行逻辑。
- 不删除任何真实数据。

## 验收

- [x] 左侧导航“首页”显示为“最近”。
- [x] 侧边栏能显示固定 UP 头像和名称。
- [x] 点击 UP 后，右侧显示该 UP 的视频列表。
- [x] 最近页仍只读取/刷新视频元数据，不触发下载或转写。
- [x] TypeScript 和相关静态检查通过。

## 完成记录

- 左侧主导航“首页”更名为“最近”。
- 侧边栏新增“视频来源”区，固定 UP 以圆形头像和名称展示。
- “管理固定 UP”弹窗迁移到侧边栏来源区。
- 右侧最近页默认显示最近视频；点击侧边栏某个 UP 后切换为该 UP 的视频列表。
- 右侧不再显示独立的视频来源选择板块。
- 验证通过：
  - `cd desktop && npx tsc --noEmit`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-home-dashboard-safety.mjs`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs`
  - 浏览器预览：左侧显示“最近”和“视频来源”，右侧显示“最近”内容区。
