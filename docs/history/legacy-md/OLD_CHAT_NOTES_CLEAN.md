# OLD_CHAT_NOTES_CLEAN.md

> 来源：旧对话交接总结。  
> 用途：为新对话提供历史线索。  
> 可信度规则：本文件不是项目事实的最终来源；所有内容仍需通过当前代码、实际运行结果和项目负责人确认。

## 一、项目当前方向（待新对话核验）

### 长视频 / 本地视频

- 提取字幕或执行音频转写；
- 清洗字幕；
- 导出适合 NotebookLM 导入的资料；
- 不再恢复旧 Codex Goal 深写或课程制作路线。

### 短视频

- 清洗字幕；
- 调用 MiMo 生成轻量、清晰、可读的精读稿；
- 进入专注、档案、灵犀和邮件链路；
- 目标不是越长越好，而是帮助快速了解新视频内容。

## 二、建议作为产品约束保留的内容

这些来自历史对话，应由项目负责人确认后写入 `PRODUCT.md`：

- 不修改 `C:\Users\Yu\AI\Onboard`；
- 不恢复旧制课路线；
- 不让旧 course / lesson / quiz 语言继续影响当前产品；
- 软件界面保持简洁、集中、少按钮、少解释文字；
- 长视频以清洗和 NotebookLM 导入为主；
- 短视频摘要应更轻、更快、更适合日常阅读；
- 自动跟踪收藏来源或关注来源的新视频；
- 同一视频不能重复制作；
- 队列完整任务并发上限为 3；
- 邮件推送应像日报一样容易阅读。

## 三、当前代码线索（仍需新对话重新确认）

### 主要模块

- B 站来源：`desktop/electron/bilibiliSourceApi.ts`
- 收藏来源：`desktop/electron/pinnedSourcesStore.ts`
- 新视频发现：`desktop/electron/sourceDiscovery.ts`
- 任务队列：`desktop/electron/workbenchQueue.ts`
- 队列执行：`desktop/electron/queueExecutor.ts`
- 后台自动化：`desktop/electron/automationController.ts`
- 窗口与托盘：`desktop/electron/windowController.ts`
- 字幕清洗和短视频编稿：`src/distiller.py`
- 设置：`desktop/electron/settings.ts`
- SMTP：`desktop/electron/smtpEmail.ts`
- 邮件推送：`desktop/electron/emailPush.ts`
- 档案：`desktop/electron/learningLibraryStore.ts`
- 灵犀索引：`desktop/electron/knowledgeLibrary.ts`
- 流程透明页：`desktop/src/components/WorkflowPane.tsx`

### 数据位置线索

- 默认输出根目录：`C:\Users\Yu\AI\视界专注\output`
- 材料目录：`output\materials\*.course_material`
- Electron `userData` 中可能包含：
  - `.shijie-focus.local.json`
  - `.shijie-focus.window.json`
  - `.shijie-focus-runtime.log`

### 敏感配置线索

- B 站 `SESSDATA`
- MiMo API key
- TTS 配置
- SMTP / QQ 邮箱授权码
- 本地 SenseVoice 路径
- Obsidian vault 路径

不得在新文档、日志或 Git 中显示真实秘密值。

## 四、已退出的历史路线

这些内容只作为历史记录，不应成为当前实现方向：

- Codex Goal 长视频深写；
- v8 / v9 学习页实验；
- course-package；
- quiz / standard_answer；
- 旧课程制作产品语言；
- validator / trace / evidence gate 重型流程；
- Mermaid / KaTeX / Cytoscape 默认渲染路线；
- 本地软件正面复制 NotebookLM 的方案。

## 五、当前高风险区域

以下内容适合作为审计重点，而不是立即重构目标：

- `src/distiller.py`：职责过多；
- `desktop/src/components/WorkspacePane.tsx`：主要状态容器；
- `desktop/electron/main.ts`：模块装配中心；
- 旧 course / lesson 兼容类型；
- `.course_material` 命名与当前产品语义不一致；
- `PROJECT_CONTEXT.md` 可能承担过多职责。

## 六、使用规则

新对话应当：

1. 把本文件当作线索，不当作最终事实；
2. 重新阅读代码和当前文档；
3. 重新运行项目；
4. 把已确认事实写入 `PRODUCT.md`、`ARCHITECTURE.md` 和 `CURRENT_STATE.md`；
5. 把未确认问题移入 `docs/VERIFICATION_BACKLOG.md`；
6. 不把历史路线重新带回当前产品；
7. 不直接根据本文件开始重构。
