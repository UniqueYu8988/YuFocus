# 侧边栏精简与缩小

状态：已完成

## 目标

删除侧边栏中的流程说明卡片，并把侧边栏整体显示比例进一步缩小。

## 范围

- 删除“UP 主 → 视频 → 字幕 → 清洗稿”说明卡片。
- 缩小侧边栏默认宽度、最小宽度和相关元素比例。
- 缩小侧边栏导航项、来源项、头像、字体和间距。
- 保留最近、任务队列、输出、视频来源、流程和设置入口。

## 不做

- 不改变视频刷新、注册表、入队或任务执行逻辑。
- 不删除任何真实数据。
- 不改变右侧内容区业务行为。

## 验收

- [x] 侧边栏不再显示流程说明卡片。
- [x] 侧边栏整体宽度和内部元素更紧凑。
- [x] 最近、任务队列、输出、视频来源、流程、设置仍可见。
- [x] TypeScript 和相关静态检查通过。

## 完成记录

- 删除侧边栏“UP 主 → 视频 → 字幕 → 清洗稿”说明卡片。
- 侧边栏默认宽度从 240 调整为 208，并使用新的本地宽度记忆键，避免继续沿用旧比例。
- 侧边栏最小宽度调整为 176，最大宽度调整为 280。
- 同步缩小导航项、来源项、头像、字体、徽标和间距。
- 验证通过：
  - `cd desktop && npx tsc --noEmit`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-home-dashboard-safety.mjs`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs`
  - 浏览器预览：侧边栏宽度为 208px，说明卡片已消失，主要入口仍可见。
