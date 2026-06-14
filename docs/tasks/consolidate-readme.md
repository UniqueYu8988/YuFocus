# 任务：收束 README.md

创建日期：2026-06-12
状态：已完成

## 1. 目标

把根目录 `README.md` 收束为简洁、长期稳定的人类项目入口，只保留项目简介、核心用途、环境准备、启动方式、基础验证、数据安全和正式文档入口。

## 2. 背景

旧 `README.md` 同时保存产品路线、流程细节、材料包结构、后台推送、配置说明和旧路线边界，容易与 `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 重复维护。

## 3. 本次范围

- 逐段检查旧 `README.md`。
- 核对启动、检查和构建命令是否对应 `desktop/package.json`。
- 将 README 改为简洁入口。
- 必要时只更新与 README 收束直接相关的正式文档。

## 4. 明确不做

- 不修改生产代码。
- 不更新依赖。
- 不启动软件。
- 不继续设计产品内容。
- 不处理其他旧 Markdown。
- 不新增长期说明文件。
- 不删除 `README.md`。
- 不把 `README.md` 写成新的万能上下文文件。

## 5. 验收标准

- [x] README 只保留简洁入口信息。
- [x] 启动命令已按 `desktop/package.json` 核对。
- [x] 类型检查和构建命令已按 `desktop/package.json` 核对。
- [x] 数据路径已与 `ARCHITECTURE.md` / `PRODUCT.md` 核对。
- [x] README 不展示秘密值。
- [x] README 不再重复维护详细产品、架构和当前状态。
- [x] 已检查 Markdown 差异，没有无关修改。

## 6. 相关文件和数据

- `README.md`
- `desktop/package.json`
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `docs/BASELINE_ACCEPTANCE.md`

## 7. 风险

- README 过长会重新变成万能上下文文件。
- README 过细会与正式文档重复，后续容易过期。
- 启动软件可能触发运行写入，本轮禁止启动。

## 8. 验证方式

- 自动测试：本轮只核对命令，不执行启动或构建。
- 人工验收：检查 README 是否只作为入口。
- 构建或类型检查：不执行；命令来源已通过 `desktop/package.json` 和基线文档核对。

## 9. 完成记录

### README 保留内容

- 项目简介和当前粗略核心能力。
- 正式工作流文档入口。
- 环境准备、启动方式和基础验证命令。
- 重要数据位置和安全提示。
- 当前状态入口。

### 已迁移或确认存在的位置

- 产品边界和当前用途：已由 `PRODUCT.md` 维护，README 只保留概述和链接。
- 架构、模块、数据流和数据位置：已由 `ARCHITECTURE.md` 维护，README 只保留常用路径。
- 当前状态、风险和下一步：已由 `CURRENT_STATE.md` 维护，README 只链接。
- AI 工作规则：已由 `AGENTS.md` 维护，README 只列入口。
- 待验证问题：继续由 `docs/VERIFICATION_BACKLOG.md` 维护。

### 移除的旧 README 内容

- `.course_material` 内部详细文件清单。
- 后台自动化和邮件推送的详细产品路线。
- 旧课程、Codex Goal、学习包等历史边界长说明。
- 配置项的详细解释，避免 README 变成新的万能上下文。

### 命令核对

- `cd desktop; npm run dev`：对应 `desktop/package.json` 的 `dev` 脚本。
- `cd desktop; npx tsc --noEmit`：对应现有 TypeScript 检查方式。
- `cd desktop; npm run build:web`：对应 `desktop/package.json` 的 `build:web` 脚本。
- Python 语法检查和邮件正文契约检查与当前基线文档一致。

本轮未启动软件、未运行构建、未修改生产代码。
