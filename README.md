# 视界专注 · YuFocus

视界专注是一款面向 B 站课程与长视频的交互式伴学桌面工具。

它的目标不是“看完视频后给你一份总结”，而是把一段原始课程内容蒸馏成可学习的知识树，再通过 AI 教练带你一关一关推进，形成从“生肉视频”到“结构化学习”的闭环。

## 项目定位

视界专注聚焦一件事：

- 输入一个 B 站视频链接或 BV 号
- 自动抓取字幕，或在没有字幕时走音频下载与转写兜底
- 把超长文本蒸馏成结构化课程包
- 在桌面端以“主线 + 教练工作台”的方式持续学习

它不是 OCR / 多模态工具。
当前版本坚持纯文本路线，不做画面识别，只依赖字幕或转写文本完成 MVP 闭环。

## 核心思路

项目分成两个层面：

- 后端蒸馏引擎：负责从 B 站和音频文本中生产课程包 JSON
- 桌面端学习工作台：负责读取课程包，驱动主线解锁、问答、纠错和进度保存

整个链路是：

1. 传入 B 站链接或 BV 号
2. 获取视频信息和字幕
3. 无字幕时触发音频下载与转写兜底
4. 对超长文本做 chunk 切片
5. 通过两阶段蒸馏生成 `Course Package`
6. 将课程包注入 Electron + React 学习工作台
7. 由 AI 教练按节点推进“讲解 -> 小测 -> 纠错 -> 通关”

## 功能概览

当前版本已经具备这些能力：

- B 站视频信息获取
- 字幕抓取与多分 P 处理
- 无字幕时的音频兜底与转写
- 课程包 JSON 结构化蒸馏
- 左侧主线树与节点依赖解锁
- 右侧 AI 教练学习台
- 学习记录自动保存与恢复
- 本地学习档案管理
- 课程包导入
- 桌面端设置中心
- 便携版打包

## 目录结构

```text
视界专注/
├─ assets/                     # 图标等资源
├─ desktop/                    # Electron + React 桌面端
│  ├─ electron/                # 主进程与 preload
│  ├─ src/                     # 前端界面、状态机、组件
│  ├─ scripts/                 # 打包辅助脚本
│  └─ package.json
├─ src/                        # Python 后端与蒸馏引擎
│  ├─ bilibili_api.py          # B 站拉取能力
│  ├─ audio_fallback.py        # 音频兜底、压缩、切片
│  ├─ groq_client.py           # 转写接口
│  ├─ distiller.py             # 核心蒸馏流水线
│  ├─ main.py                  # 归档/旧链路入口
│  ├─ config.py                # 统一环境配置读取
│  └─ schemas/
│     └─ course_package.schema.json
├─ output/                     # 本地输出课程包
├─ requirements.txt
└─ README.md
```

## 技术架构

### 1. Python 蒸馏引擎

主要职责：

- 解析视频信息
- 抓取字幕
- 无字幕时下载音频并进行转写
- 对原始文本切片
- 执行 Map-Reduce 风格蒸馏
- 输出课程包 JSON

关键模块：

- `src/bilibili_api.py`
- `src/audio_fallback.py`
- `src/groq_client.py`
- `src/distiller.py`
- `src/config.py`

### 2. Electron 桌面壳

主要职责：

- 提供桌面窗口
- 保存本地设置
- 启动 Python 子进程
- 桥接前端与后端
- 处理文件导入、打开目录、外链跳转

关键模块：

- `desktop/electron/main.ts`
- `desktop/electron/preload.ts`

### 3. React 学习工作台

主要职责：

- 课程中心
- 主线渲染
- 学习台交互
- 设置中心
- 学习档案恢复

技术栈：

- React 19
- Zustand
- Tailwind CSS
- shadcn 风格组件

关键模块：

- `desktop/src/store.ts`
- `desktop/src/components/CourseOutlinePane.tsx`
- `desktop/src/components/CoachPane.tsx`
- `desktop/src/components/WorkspacePane.tsx`

## Course Package 是什么

蒸馏后的课程包是项目的核心中间产物。

它本质上是一个结构化 JSON，包含：

- 课程标题与总体目标
- 章节树
- 每个节点的核心概念、示例、总结
- 节点依赖关系
- 可扩展的 `assets` 和 `gaps` 字段

Schema 位于：

- `src/schemas/course_package.schema.json`

这让“蒸馏”和“带学”可以彻底解耦：

- 蒸馏负责产出标准课程包
- 学习台负责消费课程包并组织学习流程

## 学习台如何工作

学习台不是普通聊天框，而是一个带状态机的伴学工作台。

每个节点都有自己的学习会话，核心状态包括：

- `teaching`：讲解中
- `quizzing`：提问中
- `correcting`：纠错中
- `completed`：已掌握

推进机制：

1. AI 教练解释当前节点
2. 教练发起提问或情景题
3. 用户回答
4. 如果答错，进入纠错并继续停留在本节点
5. 如果答对，标记完成，解锁后续节点

同时系统会对下一小关做预热，减少切换等待。

## 配置项说明

当前桌面端设置中心支持这些配置：

- Coach API Base URL
- Coach API Key
- Coach Model
- Distiller API Base URL
- Distiller API Key
- Distiller Model
- Groq API Key
- Groq Transcription Model
- B 站 `SESSDATA`

敏感信息不会明文写进源码。

保存方式：

- 桌面端通过 `electron-store` 保存在用户本地
- Python 侧通过环境变量动态注入读取

## 本地运行

### 后端依赖

建议 Python 3.10+

安装：

```bash
pip install -r requirements.txt
```

### 桌面端依赖

```bash
cd desktop
npm install
```

### 启动开发环境

```bash
cd desktop
npm run dev
```

## 打包方式

生成便携版：

```bash
cd desktop
npm run build:portable
```

生成后产物位于：

- `desktop/release/视界专注_v2.0.0_x64.exe`
- `desktop/release/视界专注_v2.0.0_share.zip`

## 当前使用流程

### 方式一：从 B 站视频开始

1. 打开课程中心
2. 粘贴 B 站链接或 BV 号
3. 点击“开始提炼”
4. 等待课程包生成
5. 自动切入学习台开始学习

### 方式二：直接导入课程包

1. 打开课程中心
2. 选择“导入现成课包”
3. 选择已生成的课程包 JSON
4. 进入学习台继续学习

### 方式三：从学习档案继续

1. 打开课程中心
2. 在学习档案中找到课程
3. 点击继续
4. 从上次进度恢复

## 本地持久化

项目当前会在本地保存这些信息：

- 学习记录
- 当前节点进度
- 每个节点的对话历史
- 引擎配置
- 输出课程包

这让用户关闭软件后再次打开时，可以继续上次学习位置。

## 已知限制

当前版本有几个重要边界，需要诚实说明：

- 当前打包版仍依赖用户机器上存在可用的 Python 运行环境
- B 站无字幕视频可能较慢，因为会走音频下载和转写兜底
- 当前不做 OCR 或视频画面理解
- 课程蒸馏质量依赖字幕质量与模型输出稳定性
- GitHub 仓库与产品名分离：仓库使用英文 slug，产品展示名保持“视界专注”

## 为什么仓库名是 YuFocus

GitHub 仓库地址更适合使用稳定英文 slug。

因此本项目采用：

- 仓库英文名：`YuFocus`
- 产品中文名：`视界专注`

这能兼顾：

- GitHub 地址稳定
- 对外展示保持中文品牌

## 适合谁

视界专注适合这类场景：

- 想把 B 站课程快速变成结构化学习材料的人
- 不想只看“总结”，而希望被一步步带着学的人
- 需要本地主导、可恢复进度、可重复学习的人

## 后续方向

后续可继续推进的方向包括：

- 将 Python 运行时一起打包，彻底降低环境门槛
- 增强课程包质量校验与自动修复
- 增加更完善的学习统计与归档体系
- 增加更细粒度的节点预加载与缓存机制
- 未来再考虑多模态扩展接口

## 项目状态

当前仓库适合作为：

- 朋友内测
- 产品讨论
- 继续快速迭代的基础版本

如果你正在阅读这个仓库，欢迎把它理解为：

一个把“视频总结工具”推进到“AI 互动伴学系统”的早期但可用版本。
