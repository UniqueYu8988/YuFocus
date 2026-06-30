# 任务：UI 板块切换性能补丁

创建日期：2026-06-30
状态：已完成

## 1. 目标

修复桌面端操作卡顿、板块切换时反复重新加载的问题，让“最近 / 队列 / 档案 / 流程 / 设置”之间切换尽量少做重复读取，同时不能让隐藏的大面板继续拖慢滚动和动画。

## 2. 背景

当前主界面在 `App.tsx` 中按 `workspaceView === 'home'` 条件渲染 `HomePane` 或 `WorkspacePane`。如果把两个大面板都常驻隐藏，虽然能减少一部分重新加载，但隐藏面板仍会订阅队列、自动化状态并进行档案 / 队列计算，真实体感会变成滚动和动画延迟更强。正确方向是：只挂载当前主面板，首页使用内存快照缓存减少切回时空白重读。

## 3. 本次范围

- 保持当前主面板单独挂载，避免隐藏的大面板继续参与计算。
- 首页使用内存快照缓存，切回“最近”时先显示上一次数据，不进入空白 loading。
- 避免首页在只是切换 UP 来源时重复读取完整本地快照。
- 增加轻量静态检查，防止重新引入“隐藏双面板常驻”导致滚动卡顿。

## 4. 明确不做

- 不修改自动队列、转写、MiMo 清洗、本地总结或邮件发送逻辑。
- 不删除或迁移 `data/materials`、`data/registry` 或 Electron Store 数据。
- 不做大规模拆分 `WorkspacePane.tsx`。
- 不做真实队列运行或真实外部服务调用。

## 5. 验收标准

- [x] `HomePane` 与 `WorkspacePane` 不再同时常驻隐藏，切换时只挂当前主面板。
- [x] `HomePane` 有内存快照缓存，切回最近时不显示空白初始 loading。
- [x] 切换首页中不同 UP 来源不触发完整 `loadLocalSnapshot`。
- [x] TypeScript 类型检查通过。
- [x] 相关静态检查通过。

## 6. 相关文件和数据

- `desktop/src/ui/App.tsx`
- `desktop/src/ui/pages/HomePane.tsx`
- `desktop/src/ui/pages/WorkspacePane.tsx`
- `desktop/scripts/check-ui-panel-switch-performance.mjs`

## 7. 风险

- 首页内存缓存可能在切回时短暂显示上一次数据；用户手动刷新或后续事件会更新它。
- 工作区离开首页后仍会重新挂载，因此队列 / 档案内部更深层的状态缓存和列表虚拟化仍可作为下一步优化。

## 8. 验证方式

- 自动测试：新增静态检查脚本。
- 人工验收：打开桌面端后快速切换最近 / 队列 / 档案 / 设置，确认不出现明显重新加载。
- 构建或类型检查：`npx tsc --noEmit`。

## 9. 完成记录

完成日期：2026-06-30

完成内容：

- `desktop/src/ui/App.tsx`：撤回“双面板常驻 hidden”方案，恢复只挂载当前主面板，避免隐藏工作区继续进行大量队列 / 档案计算并拖慢滚动动画。
- `desktop/src/ui/pages/HomePane.tsx`：新增 `homePaneSnapshotCache` 内存快照；切回“最近”时直接恢复固定 UP、队列、材料、注册表和自动化状态的上一次快照；`loadLocalSnapshot` 不再依赖 `activeSourceId`，点击侧边栏不同 UP 只切换前端列表，不触发完整本地快照重载。
- `desktop/scripts/check-ui-panel-switch-performance.mjs`：新增回归检查，防止以后重新引入隐藏双面板常驻，也保护首页缓存和来源切换不重载。
- `desktop/scripts/check-home-dashboard-safety.mjs`：恢复“最近页独立渲染”的安全口径，同时要求首页有内存缓存，并继续保护首页不调用下载、转写、自动检查和删除类高风险入口。
- 浏览器预览 smoke test：刷新 `http://localhost:5173/`，只读检查无控制台错误；点击“队列”再回“最近”无控制台错误。

验证结果：

- `node desktop/scripts/check-ui-panel-switch-performance.mjs` 通过。
- `node desktop/scripts/check-home-dashboard-safety.mjs` 通过。
- `node desktop/scripts/check-product-refactor-surface.mjs` 通过。
- `npx tsc --noEmit` 通过。

遗留说明：

- 本补丁修复上一版 hidden 常驻造成的滚动/动画延迟，并缓解“最近”页切回重载。如果真实桌面端仍有明显卡顿，下一步应继续做队列 / 档案列表虚拟化，或把 `WorkspacePane.tsx` 的重计算拆成更细的 memo / selector。
