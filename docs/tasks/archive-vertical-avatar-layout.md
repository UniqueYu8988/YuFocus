# 档案页上下结构头像导航

最后更新：2026-06-29

## 目标

把档案页当前“左侧 UP 分组 + 右侧视频资料”的左右结构，改为上下结构：

- 上方横向展示 UP / 全部 / 拾遗入口；
- UP 使用圆形头像；
- 头像右上角显示视频数量角标；
- 下方展示所选 UP 的视频资料列表。

## 范围

- 只修改档案页展示结构。
- 保留现有只读材料扫描、分组模型、搜索、打开、复制路径、定位和删除入口。
- 不迁移、不删除、不改写 `data/materials`。

## 验证

- `node --experimental-strip-types --no-warnings scripts/check-archive-up-grouping.mjs`：通过。
- `npx tsc --noEmit`：通过。
- `node scripts/check-product-refactor-surface.mjs`：通过。
- `git diff --check`：通过；仅出现 Windows 换行提示。

## 状态

- 已完成。
