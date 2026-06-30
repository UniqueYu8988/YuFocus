# CURRENT_STATE.md

本文件只记录项目“现在”的状态，不保存完整历史。

最后更新：2026-07-01

## 当前阶段

项目底层工作流改造已完成，后续进入常规小步稳定化开发。  
下一阶段主线已调整为“UP 主驱动的字幕清洗”：UP 主 / 来源视频列表 → 批量选择 → 字幕获取 → 字幕清洗 → NotebookLM 可导入资料。
字幕系统是当前核心数据层；旧精读稿和 TTS 不再作为主线推进。最近更新邮件已恢复为独立通知层：只消费本地总结产物，只对 `fresh` 新视频发送，历史补全不发送。
旧档案、旧灵犀和旧学习包兼容链路暂时降级为旧版遗留，后续只做必要兼容，不作为当前稳定化最高优先级。

## 当前可正常使用

- 代码层面已确认存在桌面端、Python 后端、材料包扫描、设置、队列、后台自动化和字幕清洗主线；TTS、邮件测试和 Obsidian IPC / CLI 入口已在安全剪枝中移除。
- 桌面端可以启动并默认显示“最近”页；最近页首次只读本地数据，手动更新只刷新来源视频元数据，不自动入队、下载或转写。
- 设置页可以打开；本轮未复制或输出 Cookie、API Key、SMTP 授权码等秘密值。
- 左侧栏保留最近、队列、档案、流程、设置入口，并承载固定 UP 视频来源列表；旧灵犀 / 学习入口不再作为主导航。
- 安全检查通过：`npx tsc --noEmit`、Python 语法检查、`desktop/scripts/check-distill-progress.mjs`、`desktop/scripts/check-subtitle-only-queue-mode.mjs`、`desktop/scripts/check-data-layer-normalization.mjs`。
- 已安装的本机基础环境：Node.js `v24.13.0`、npm `11.6.2`、Python `3.12.10`。
- Python 依赖探测显示 `requests`、`jsonschema`、`PySide6`、`imageio_ffmpeg` 已安装。

## 当前正在处理

- 旧 Markdown 集中收束已完成；旧项目语境、旧清理基线、纪念报告、旧系统审计、旧视频编稿流程和旧聊天记录均已归档到 `docs/history/legacy-md/`。
- 项目底层工作流改造已完成；独立新对话已经成功完成接管评估，不依赖此前聊天记录也能确认项目事实、风险、验证能力和下一步。
- 后续代码任务全部按照 `AGENTS.md` 的新工作流执行：先读入口文档，按任务规模定界，小步实施，运行相关最小验证，结束时更新必要状态。
- 已正式记录下一阶段主线为 UP 主驱动的字幕清洗，见 `docs/tasks/define-channel-subtitle-mainline.md`。
- 本阶段不继续做总结内容格式、邮件形态、TTS 或 NotebookLM 导读等产品细节决策。
- 代码结构与风险地图已建立，见 `docs/tasks/code-risk-audit.md`。
- 第一个低风险代码稳定化任务已完成：旧精读稿 Markdown / HTML 纯格式契约检查曾用于保护过渡期输出；v1.0 冻结前已退出 subtitle-only 验证集。
- 第二个低风险代码稳定化任务已完成：`desktop/src/domain/pipeline/distillProgress.ts` 已建立纯内存检查脚本，并补强异常进度输入兜底。
- 第三个低风险代码稳定化任务已完成：工作台队列已支持 `pipelineMode: 'subtitle_only' | 'full_editorial'`，并在 `subtitle_only` 时阻止队列层调用精读稿 / 总结、邮件等后续消费分支。
- 第四个低风险代码稳定化任务已完成：UP 主 / 来源视频列表批量加入队列和后台来源发现新建队列项已显式使用 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- 第五个受控试运行已完成并通过：1 条真实 UP 主短视频以 `subtitle_only` 入队后只触发 material builder，没有触发总结、邮件或 TTS；SenseVoice 路径已从旧目录修正为实际目录，转写兜底、字幕清洗、material package 和 NotebookLM 导出已跑通。
- 第六个结构化产品收束任务阶段 1 已完成：默认入口改为字幕流水线，主导航收束为字幕流水线 / 输出 / 流程 / 设置，队列 UI 隐藏手动制作文稿入口，设置页隐藏邮件、TTS 和 Obsidian 旧配置块。
- 第七个安全剪枝任务已完成：删除旧阅读 UI 静态链、TTS IPC / 服务、邮件发送服务、Obsidian CLI / IPC / 导出服务和未引用语音预览资产；保留 subtitle-only 主线和旧数据兼容读取。
- 第八个清晰产品架构任务已完成：桌面端源码迁移为 `desktop/src/ui`、`domain`、`services`、`state`、`legacy` 和 `desktop/electron/ipc`、`runtime`、`queue`、`providers`、`services`、`legacy` 分层；未修改 Python 和 subtitle-only 主线逻辑。
- 第九个数据层标准化任务已完成：新的生产输出根已收敛为 `data/materials/{up_id}/{video_id}`，缓存、临时文件、日志和遗留知识库分别进入 `data/cache`、`data/temp`、`data/logs`、`data/legacy`。
- 第十个 v1.0 冻结前最终遗留清理已完成：删除未引用旧 SVG、旧精读 / 邮件过渡期检查脚本、旧合成计划检查脚本，以及按项目负责人确认删除旧 `output/` 测试生成内容；旧 `output` 不再作为兼容输出根或生产数据来源。
- 第十一个数据稳定性任务已完成：新增 `data/registry/{up_id}.json` 视频注册表层，UP 主视频刷新改为 API 结果合并入本地 registry 后再返回列表，避免 API 临时缺失导致视频消失；后台来源发现也走同一稳定列表。
- 第十二个稳定性任务已完成：修正运行时注册表路径，4 个旧注册表无损迁移到 `data/registry` 并保留独立备份；连续真实刷新保持每表 30 条、0 重复。
- 本机旧 `output_dir` 已在备份 Store 后通过应用自身设置 API 持久化为项目 `data` 根。
- “清空队列”已改为只清理队列记录，不再扫描、归档或删除材料包；纯内存检查和真实 IPC 回归均通过。
- 真实桌面端小样本 `BV131jF68E5n` 已在 `data/materials/256724889/bv131jf68e5n` 完成 subtitle-only 流程。
- 本轮已把代码、文档和目录迁移收敛为一个 Git 稳定存档点；`data/` 真实运行数据由 `.gitignore` 排除。
- “最近”页已完成：顶部已精简为只保留刷新图标；左侧栏显示“最近”和固定 UP 视频来源，固定 UP 以圆形头像加名称呈现，并通过侧边栏“管理固定 UP”弹窗设置；右侧默认显示最近视频，点击左侧某个 UP 后显示该 UP 的视频列表；用户可勾选视频并手动加入队列。真实桌面端手动刷新后只更新元数据，不自动触发下载、转写或制作。
- 主导航命名已收敛为“最近 / 队列 / 档案 / 流程 / 设置”；档案页已接入只读 UP 主分组，并改为上下结构：上方横向展示 UP / 全部 / 拾遗圆形头像入口，头像右上角显示对应视频数量角标；下方显示当前分组的视频资料卡片；当前不迁移、不删除、不改写真实资料。
- 档案页视觉密度已进一步优化：头像数量角标改为半透明毛玻璃效果；顶部统计只保留总字数、占用、耗时、MiMo Credits 四项；UP 主头像条和资料列表合并为一个轻量容器；资料列表删除阶段、原字、清洗、文稿、HTML、长稿等低价值标签，改为突出标题、BV / 来源、更新时间、字数、占用、耗时和 MiMo Credits。
- UP 主自动同步调度升级已完成，并已追加后台自动运行补丁：工作台队列强制一次只处理 1 条；固定 UP 会同步出 `trackedBilibiliSources` 追踪状态；侧边栏固定 UP 列表按 tracking 优先级展示，并可通过提高 / 降低按钮保存 UP 历史补足优先级；后台自动化默认对齐下一个整点，每小时检查启用 `trackFresh` 的 UP，新发现视频以 `fresh` 来源自动入队；当没有 fresh 和可立即领取的队列项时，会从 registry 或 B 站历史分页中按 UP 优先级补 `history` 任务，并保存每个 UP 的 `historyPage` / `historyReachedEnd` 游标；队列空闲后会触发 `idle-backfill` 继续补下一条历史任务，不再等下一个整点；未来才到期的 retry 项不会阻塞历史补足，retry 到点会自动唤醒；付费、充电、权限受限、`HTTP 412` 或无音频轨等不可重试媒体访问错误会标记为 `skipped / 已跳过`，不再自动重试；最近页已提供暂停 2h、5h、手动暂停和恢复入口，并新增一条极简实时状态提示，用来显示正在处理的视频、等待数量、暂停状态、下次检查时间或同步异常；临时失败会按 5 分钟、30 分钟、2 小时最多重试 3 次，配置类失败会暂停后台同步；队列页已改为轻量记录流，初始 10 条，滚动加载，去除旧外框、分页器、清空 / 删除类按钮，并显示单条已完成视频的总耗时和 MiMo Credits；真实运行中已看到 2026-06-28 21:00 至 2026-06-29 02:00 多次准点后台检查和自动队列处理记录；本轮只读统计 `data/materials` 为 288 个文件，未执行删除、迁移或重命名材料操作。
- B 站多语言字幕误合并补丁已完成：同一分 P 同时存在中文和英文字幕时，正文只使用中文轨；没有中文时才使用英文兜底，避免中英两套完整字幕同时进入 `raw_transcript.txt`、`content.md` 和 `exports/notebooklm.md`。已生成的旧材料包不会自动改写，需重跑对应视频后才会得到新产物。
- MiMo 字幕清洗默认模型已从 `mimo-v2.5-pro` 切换为非 Pro 的 `mimo-v2.5`；旧设置中保存的 Pro 值在加载和后台运行时都会自动降级，降低 Token Plan Credits 消耗。
- MiMo UP 定制清洗提示词实验层已完成：`src/distiller.py` 已新增 7 个重点 UP 的清洗 profile；`desktop/scripts/generate_mimo_cleaning_prompt_lab.py` 可在 `data/temp/mimo-cleaning-prompt-lab/` 中循环生成 baseline / profiled / iteration-2 对比结果，并支持 `--reevaluate-existing` 不重复消耗 MiMo token 重评质量；真实小样本最终 7/7 通过。该机制尚未接入正式 `data/materials` 生成链路。
- “MiMo 主资料 + 本地模型消费层 / 门控”已接入正式后置链路：subtitle-only 材料生成 NotebookLM 主资料后，会调用本地 Ollama `shijie-qwen3-8b-q4-chat` 生成 `exports/brief.local.md`、`delivery/email.md`、`delivery/decision.json`、`work/quality/local_check.json` 和 `work/local_consumption/run_meta.json`，并更新 `manifest.json`、`metrics.json`、`run_state.json`；本地消费层失败或需复核不会让 NotebookLM 主资料失败。
- 本机 Ollama + Qwen3-8B 本地模型试运行已完成：模型原始文件位于 `C:\Users\Yu\AI\Cuda\models\Qwen3-8B-GGUF\Qwen3-8B-Q4_K_M.gguf`，Ollama 运行仓库已同步到 `C:\Users\Yu\AI\Cuda\ollama-models`，推荐接入模型名为 `shijie-qwen3-8b-q4-chat`。该模型通过了 brief、邮件草稿和 JSON 判断的最小冒烟测试；旧模型名 `shijie-qwen3-8b-q4` 缺少正确聊天模板，不建议接入。
- “本地 Ollama adapter 试接”已完成：任务文件 `docs/tasks/local-ollama-adapter-phase2.md` 和详细计划 `docs/plans/local-ollama-adapter-phase2-plan.md` 已补充完成记录。4 个真实小样本均生成成功，brief / email / decision / quality_check 全部为 `ok`；重复运行会跳过已完成样本；该阶段仍不接入队列、不改写真实材料包、不发送邮件。
- “本地消费层正式闭环补丁”已完成：任务文件 `docs/tasks/autopilot-local-summary-closure-patch.md` 和计划 `docs/plans/autopilot-local-summary-closure-patch-plan.md` 已记录完成结果。新约 10 分钟样本 `BV1MBjx6cEHw` 完整跑通 B 站元数据 → SenseVoice 转写 → MiMo 清洗 → NotebookLM 主资料 → 本地 Ollama brief/email/decision/quality，材料生成 57.207 秒，本地消费层 18.476 秒；`--material-only` 不再生成旧 `summary/`，`manifest.editorial_summary.status=skipped`。
- 本地 brief / email 成稿门控补丁已完成：任务文件 `docs/tasks/local-brief-output-guard-fix.md` 已记录完成结果。Markdown 输出预算从 256 提升到 1024，brief / email 增加自我分析文字、过短、无标题和半句截断检查，失败会用严格成稿提示词自动重试一次。中文样本 `BV1i5jy6bECe` 重跑后 `exports/brief.local.md` 为 1100 字、`delivery/email.md` 为 558 字，均无过程性文字，`quality.riskLevel=low`。
- 最近更新邮件转发生产化补丁已完成：正式 MiMo 清洗回到通用高保真逐字清洗，UP 定制 prompt 只保留为 `data/temp/mimo-cleaning-prompt-lab/` 实验层；本地 brief 升级为事实门控版高信息密度总结，Ollama 上下文和输出预算提高；新增 `desktop/electron/services/emailDeliveryService.ts` 使用 `nodemailer` 发送邮件，只允许 `queueSource === 'fresh'` 的最近更新视频在本地总结和质量门控通过后发送。`history`、`manual`、`retry`、`follow_source` 不发送；重复内容通过 `delivery/email_status.json` 跳过；SMTP 密码不写入状态、日志或产物；邮件失败不影响队列完成。
- UI 板块切换性能补丁已完成：撤回“双面板常驻 hidden”方案，保持当前主面板单独挂载；“最近”页新增内存快照缓存，切回时优先恢复上一次本地数据，切换左侧不同 UP 来源不再触发完整本地快照重载。该补丁不修改队列、转写、MiMo 清洗、本地总结、邮件发送或真实材料数据。
- 下一阶段“桌面便携版和安装包体验优化”已开启，见 `docs/tasks/package-desktop-portable-release.md` 和 `docs/plans/package-desktop-portable-release-plan.md`。第一目标是生成可双击运行的 Windows x64 便携版；外部模型保持按需调用，不把 SenseVoice、CUDA、Ollama 或 Qwen3 模型打进第一版安装包。
- 桌面便携版阶段 1-3 已完成首轮落地：`npm run build:portable` 已生成 `desktop/release/视界专注_v0.1.0_x64.exe` 和 `desktop/release/视界专注_v0.1.0_share.zip`；受控启动确认便携版页面标题为“视界专注”；设置页新增“运行环境自检”，可检查内置后端脚本、Python、Python 依赖、本地 SenseVoice、Ollama、MiMo、B 站凭据和 SMTP。自检不加载 SenseVoice 模型，不生成 Ollama 文本，不调用 MiMo 或 SMTP，不展示秘密值。
- 桌面便携版第一版已完成：新增 `desktop/scripts/check-packaged-portable-smoke.mjs`，自动启动便携 exe、打开最近 / 队列 / 档案 / 流程 / 设置、调用环境自检并检查启动日志。第一版安装包结论为暂不进入 NSIS 安装器阶段；当前以便携版作为可双击使用形态，外部 Python / SenseVoice / Ollama / Qwen3 继续按需调用。
- 便携版最近页自动同步条幅循环闪烁问题已修复：重复历史补足视频被队列去重后，不再触发保存、广播和队列处理；自动化检查发现结果非空时，也会再次确认队列中是否有可领取任务，避免 `idle-backfill` 高频循环。已重新生成 `desktop/release/视界专注_v0.1.0_x64.exe`，桌面快捷方式仍指向该文件。
- 付费、权限受限、HTTP 412、无音频轨等失败视频已从队列主列表中折叠：没有资料产物的 `failed / skipped` 队列记录会进入“无法获取的视频”折叠区，默认不占用正常队列视线，也不再在后台状态里显示为“需要重试”；历史补全可以继续寻找后续可处理视频。已重新生成便携版 exe。
- 队列与档案页 UI 密度优化已完成：队列页去掉内部滚动容器，避免双重滚轮；队列和档案页删除标题下解释性副标题；队列和档案列表均改为初始 5 条、向下滚动后再追加 5 条；档案页删除 UP 区域最外层大圆角框、“UP 主”标题和重复的分组标题行，首行直接显示 UP 头像，选中态改为头像彩色圆环和角标变色，资料列表改为顺序列表。已重新生成便携版 exe。
- 最近视频和历史补全自动入队修复已完成：fresh 自动发现不再按 24 小时时间窗过滤，而是从各 UP 最近页汇总候选、按发布时间排序，最多取 9 条未知视频进入 `fresh` 队列；“最近”页也同步显示 9 条。应用启动后会立即执行一次 `startup` 检查，自动同步从暂停恢复后会尽快触发检查；队列达到 200 条上限时，新增任务和可处理任务优先保留在已完成 / 已失败记录前，避免历史补全被终态旧记录挤掉。历史补全仍以 `history` 入队，不触发邮件；只有 `fresh` 最近更新继续走清洗、本地总结、质量门控和邮件转发。已重新生成便携版 exe。
- 长期资料库文件管理已进入成品库优先阶段：`data/library` 是最终 Markdown 出口，队列完成材料后会把清洗稿同步到 `data/library/notebooklm/{UP 主}/`，把邮件稿同步到 `data/library/email/{UP 主}/`，文件名默认只保留视频标题；同一 UP 下标题冲突时才追加 ` (2)` 这类短后缀。可获得发布时间时会把成品文件修改时间设置为视频发布时间；`data/library/index.json` 记录 BV、标题、UP、发布日期、来源材料包和成品路径，用于长期去重和追踪。已有 196 份 NotebookLM 清洗稿和 2 份邮件稿已同步到长期成品库，现有 196 个 `data/materials` 材料包已瘦身为 786 个轻量记录文件。
- 档案和队列的消耗显示已从原始 total token 改为 MiMo Credits 估算：材料清单仍保留输入 / 输出 / 总 token 底账，界面使用 `input_tokens * 100 + output_tokens * 200` 展示更接近 MiMo Token Plan 控制台的扣费口径；已重新生成便携版 exe 和分享包。
- 睡前体验收束已完成代码侧改造：档案和队列的 Markdown 图标直接用系统外部应用打开清洗稿 / email 稿，旧内部 Markdown 查看器 UI 已删除；最近页刷新 / 暂停图标已移动到视频列表标题行右侧并删除“仅元数据”标签；最近页和队列状态命名已收敛为更短的彩色状态。高频开发阶段新增 `desktop/scripts/start-dev-desktop.ps1` 作为开发版快捷方式入口，便携版只作为阶段存档或分享包。

## 已知问题

| 问题 | 影响 | 优先级 | 临时处理 |
|---|---|---|---|
| 后续任务绕过新工作流 | 如果不按入口和任务规模执行，仍可能跳过定界、验证或收尾记录 | 中 | 普通任务从 `AGENTS.md` 和本文件开始；中型任务先建 `docs/tasks/` 任务文件 |
| 旧入口文档可能误导新对话 | `README.md`、历史报告和已归档的旧上下文仍含旧产品叙事 | 中 | 日常入口以 `AGENTS.md`、`CURRENT_STATE.md` 和基线文档为准 |
| 核心验收仍偏旧项目基线 | 后续改造可能混入旧档案/旧灵犀细节 | 中 | 只保留核心验证，把旧细节留在 backlog |
| 旧上下文归档后的历史引用仍存在 | 历史文档和旧任务记录仍会提到 `PROJECT_CONTEXT.md` | 低 | 这些只作为历史文字，不作为日常入口 |
| 旧清理基线已归档 | 历史文档仍会提到 `docs/cleanup-baseline.md` | 低 | 这些只作为历史文字，不作为日常入口 |
| 旧 Markdown 治理阶段已结束 | 继续整理历史文档会拖延代码层稳定化 | 中 | 停止集中整理历史文档，进入代码层稳定化 |
| 档案状态文案后续统一 | 档案页已完成 UP 主分组和视频资料卡片；最近页、队列页、档案页之间的同一 BV 状态文案还可以进一步统一 | 低 | 后续另开小任务，不影响当前档案结构目标 |
| 独立灵犀页入口待核对 | 受控验收时未找到明确入口 | 低 | 旧版遗留候选问题，暂不修复 |
| 现有 51 个材料包未检测到 `metrics.json` | 旧测试数据计量不完整 | 低 | 旧版遗留，暂不回填 |
| `src/distiller.py` 职责很重 | 字幕、清洗、编稿、缓存、文件写出混在一个大文件，修改风险高 | 中 | 稳定化前不拆分，只加验收保护 |
| `desktop/src/ui/pages/WorkspacePane.tsx` 承担大量状态和业务逻辑 | UI 行为改动容易互相影响 | 中 | 本轮只搬目录，不拆逻辑；后续如整理必须另开小任务 |
| 旧学习库 / 精读稿兼容代码仍存在 | 已从主导航和主执行流隔离，但部分旧元数据和 full editorial 兼容分支仍需读取 | 中 | 用 `desktop/scripts/check-product-refactor-surface.mjs` 和 `desktop/scripts/check-subtitle-only-queue-mode.mjs` 防止主入口和队列回退 |

## 当前风险

- `data/materials` 当前主要保留轻量记录和成品引用；清空队列已与材料删除解耦，但单条“删除资料包”仍会同时删除对应材料目录和 `data/library` 成品 Markdown，必须谨慎确认。
- `data/registry` 中保存 UP 主视频列表历史，删除会让历史视频列表丢失，刷新稳定性下降。
- Electron Store 文件可能包含 B 站 Cookie、MiMo Key、MiniMax Key、SMTP 授权码等秘密值，不能展示内容或提交。
- 启动 Electron 会写运行日志；前端初次加载队列后可能写回 Electron Store；打开灵犀可能写回 `knowledge_library.json`。
- 打开设置页存在 B 站状态检测入口；本轮只刷新了指定 TED 来源，没有公开秘密值。
- 旧版遗留数据仍在项目中，不能删除真实资料；遗留代码只允许在确认无入口、无引用、无数据风险后小步剪枝。
- 字幕清洗产物是后续唯一主线数据基础；总结、邮件、TTS 不应继续绑在字幕清洗主流程里。
- `data/library/notebooklm/{UP 主}/{视频标题}.md` 是当前 NotebookLM 主输出；不能写入秘密值、调试日志、内部状态或复杂中间结果。
- `docs/VERIFICATION_BACKLOG.md` 只是不确定问题清单，不能当作当前 Bug 直接修。
- `docs/history/legacy-md/`、`README.md` 和历史文档里有旧路线内容，使用前必须与当前基线文档核对。
- `docs/history/legacy-md/cleanup-baseline.md` 是旧系统优化清理记录，已退出日常工作流。
- `PROJECT_CONTEXT.md` 已不再位于项目根目录，也不再被流程页白名单或开发项目根探测依赖。
- 构建命令会清理并重写 `desktop/dist`、`desktop/dist-electron`，本轮未执行。

## 下一步只做什么

1. 下一步不要把 MiMo UP 定制清洗 profile 接入正式字幕清洗链路；如未来重新实验，只能继续写入 `data/temp/mimo-cleaning-prompt-lab/`，不能覆盖已有 `data/materials`。
2. 下一步如继续本地消费层，应优先观察真实队列自动生成的 `exports/brief.local.md`、`delivery/email.md`、`work/quality/local_check.json` 和 `delivery/email_status.json` 阅读质量；真实 SMTP 发送只建议先用 1 条 fresh 小样本验证。
3. MiMo prompt lab 结果仍只能写入 `data/temp/mimo-cleaning-prompt-lab/`，不要覆盖已有正式 `data/materials` 清洗稿。
4. 普通后续任务继续按 `AGENTS.md` 新工作流小步推进。
5. 后续真实运行继续小批量进行，先核对队列、`data/library` 成品和 `data/materials` 轻记录，再加入新视频。
6. 如果继续剪枝，下一步应优先审计旧学习库 / 精读稿兼容链是否仍有真实数据读取价值；不删除旧数据，不碰 subtitle-only 主线。
7. 如果继续架构收敛，下一步只能做“小步抽离 UI 页面中的纯 action / selector”，不要直接拆 `WorkspacePane.tsx` 或改 pipeline 行为。
8. 如果继续使用体验优化，下一步优先执行桌面便携版构建基线：先跑 `npm run build:portable`，再按计划验证打包版启动、数据根、后端脚本路径和外部模型按需调用。

## 暂时不做

- 不改生产主流程代码。
- 不批量加入大量 UP 主视频队列；真实试运行前只允许 1 条短视频小样本。
- 不推进旧精读稿格式、复杂邮件模板、TTS 或 Obsidian。
- 不更新依赖。
- 不无备份地直接修改数据库或 Electron Store。
- 不删除、移动或重命名 `data/materials` 下的任何资料，除非任务明确要求且已完成备份或确认。
- 不拆分 `distiller.py` 或 `WorkspacePane.tsx`。
- 不恢复旧课程制作路线。
- 不继续修旧档案计数、旧材料映射、旧灵犀入口或旧学习包兼容链路。
- 不恢复旧 `output/` 作为输出根，不把旧材料格式重新接入主流程。
- 不继续决定总结内容格式、短视频稿件长度、邮件形态、TTS 或 NotebookLM 导读等产品细节。
- 不制定大文件拆分或代码重构方案。
- 不恢复 `PROJECT_CONTEXT.md` 的日常入口地位；旧内容只从归档路径按需查阅。
- 不继续集中整理旧 Markdown；后续只在具体任务需要时查阅历史归档。

## 工作流审计结论

### 已经具备

- `AGENTS.md` 已能作为 AI 第一工作入口，包含事实来源、任务规模、修改原则、验证规则和安全红线。
- `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 已基本分工：产品边界、技术结构、当前状态。
- `docs/BASELINE_ACCEPTANCE.md` 已收敛为核心启动、队列、材料、安全写入和少量核心流程基线。
- `docs/VERIFICATION_BACKLOG.md` 已声明自己不是当前 Bug 清单。
- 旧 Markdown 已统一归档到 `docs/history/legacy-md/`，不再作为日常入口。
- `docs/tasks/TASK_TEMPLATE.md` 和 `docs/plans/PLAN_TEMPLATE.md` 已存在，中型和大型任务有入口。
- 独立新对话接管测试已完成，证明当前文档可以支撑不依赖历史聊天的接管。

### 仍然缺失或冲突

- 未发现阻碍工作流结项的明显冲突。
- `README.md` 仍是项目入口说明，但不是最高事实来源；遇到差异时以 `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 和代码为准。
- `docs/VERIFICATION_BACKLOG.md` 中仍有候选问题，后续只能按任务验证，不能直接当作当前 Bug。

### 最小调整方案

1. 以 `AGENTS.md` 作为唯一第一入口。
2. 新任务先读 `CURRENT_STATE.md`，再按需要读产品、架构、验收或任务文件。
3. 旧聊天、backlog、`docs/history/legacy-md/`、`README.md` 和历史报告只作为参考线索。
4. 中型任务进入 `docs/tasks/`；大型任务再进入 `docs/plans/`。
5. 暂时不新增大量文档，不继续产品细节设计，不制定代码重构方案。

## 当前验证状态

- 项目能否启动：2026-06-29 当前可见 `npm run dev`、Vite 和 Electron 进程，`http://localhost:5173/` 返回 200；2026-06-12 曾完成受控短时间启动并关闭。
- 核心人工验收：首页通过；设置页可打开；左侧灵犀来源区可读取；档案页已完成 UP 主分组第一版代码接入，并通过受控 Electron 验收确认 2 条真实材料按 `马督工` / `TED官方精选` 分组展示，视频资料卡片保留打开 / 复制路径 / 定位入口；独立灵犀页仍属待核对现象。
- 自动测试：未发现完整测试套件；执行了 `desktop/scripts/check-distill-progress.mjs`、`desktop/scripts/check-subtitle-only-queue-mode.mjs`、`desktop/scripts/check-data-layer-normalization.mjs` 和产品表面检查，结果通过；脚本已覆盖 UP 主批量入队、后台来源发现、subtitle-only 创建规则和数据层路径规则。
- 产品收束静态检查：新增 `desktop/scripts/check-product-refactor-surface.mjs`，覆盖默认入口、主导航、队列文稿按钮隐藏、设置页邮件/TTS/Obsidian 隔离和 subtitle-only 执行器守卫。
- 最近页安全检查：新增 `desktop/scripts/check-home-dashboard-safety.mjs`，覆盖默认最近页、首次只读本地注册表、仅手动刷新元数据、侧边栏来源选择、极简实时状态提示，以及最近页不接入制作、自动化检查、下载或转写入口。
- 档案 UP 主分组检查：新增 `desktop/scripts/check-archive-up-grouping.mjs`，覆盖只读分组模型、固定 UP 空分组、同 UP 聚合、全部 / 拾遗入口和时间排序；不读取、不写入、不删除真实 `data/materials`。
- 档案视觉减负检查：`desktop/scripts/check-archive-up-grouping.mjs` 已同步覆盖毛玻璃头像角标、顶部四项统计、资料列表去除原字 / 清洗 / 文稿 / HTML / 长稿标签，并确认打开 / 复制路径 / 定位入口保留。
- 档案真实 Electron 验收：使用临时 userData 和远程调试端口启动受控开发实例，确认真实 `data/materials` 中 2 条资料显示为 UP 主分组和视频资料卡片；点击 `马督工` / `TED官方精选` 分组后右侧分别只显示对应资料；验收前后 `data/materials` 文件数量保持 48。
- 数据层标准化检查：新增 `desktop/scripts/check-data-layer-normalization.mjs`，覆盖 `data` 默认根、`data/materials`、`data/registry`、`data/cache`、`data/temp`、`data/logs`、`data/legacy`、Python 子进程环境变量和标准材料扫描，并防止旧 `output` 兼容根回流。
- 视频注册表检查：新增 `desktop/scripts/check-video-registry-layer.mjs`，使用临时目录验证 registry 合并不删除历史视频、不重复、保留本地状态、API 失败可读旧列表，并静态确认 UI IPC 和后台发现接入 registry。
- 清队列保护检查：`desktop/scripts/check-queue-clear-safety.mjs` 证明清空队列不读取材料设置、不扫描材料包、不归档材料，也不返回删除路径。
- 受控合成数据层验证：使用本地假字幕直接写出并检查 `data/materials/codex_validation_up/bv_codexdatalayervalidation`，核心文件齐全；随后删除测试视频目录和空 UP 目录，未调用外部服务。
- v1.0 最终遗留清理验证：`check-subtitle-only-queue-mode`、`check-data-layer-normalization`、`check-product-refactor-surface`、`check-distill-progress`、核心 Python `py_compile` 和 `npx tsc --noEmit` 均通过；未启动软件、未运行真实队列、未调用外部服务。
- 真实小样本：`TED官方精选` 的 `BV131jF68E5n` 已以 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'` 在新 `data` 根完成；生成原始转写、清洗稿、NotebookLM 稿、manifest 和 run_state，`run_state` 为 `content_ready`，summary 为 `skipped`，日志中 summary / 邮件 / TTS 调用均为 0。
- 真实清队列保护：清理 2 条已完成队列记录后，材料清单前后保持同一路径，返回 `deletedMaterialCount: 0` 和空删除路径；随后原队列记录已恢复。
- UP 自动同步目标验证：`check-up-sync-scheduler`、`check-queue-record-feed`、`check-efficiency-observability`、`check-home-dashboard-safety`、`check-tracked-sources-store`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-video-registry-layer`、`check-product-refactor-surface`、`npx tsc --noEmit` 和 `git diff --check` 均通过；`git diff --check` 只有 Windows 换行提示。
- 字幕语言选择补丁验证：`node desktop/scripts/check-subtitle-language-selection.mjs` 通过，覆盖中文 + 英文只选中文、仅英文时英文兜底、无中英文时取第一条；`python -m py_compile src/bilibili_api.py` 通过。
- MiMo 非 Pro 默认检查：`node desktop/scripts/check-mimo-non-pro-default.mjs` 通过，覆盖设置默认、旧 Pro 自动降级、后台 Python 环境和前端设置候选项。
- MiMo UP 定制清洗提示词实验验证：`python desktop/scripts/generate_mimo_cleaning_prompt_lab.py --force --samples-per-up 1 --raw-limit 3000` 真实调用 MiMo 后 6/7 通过；修正新闻分条提示和英文原文 → 中文清稿评分后，`python desktop/scripts/generate_mimo_cleaning_prompt_lab.py --reevaluate-existing --samples-per-up 1 --raw-limit 3000` 不重复调用 MiMo 重评为 7/7 通过；`node desktop/scripts/check-mimo-cleaning-prompt-lab.mjs` 通过。
- 本地消费层第一阶段检查：`node desktop/scripts/check-local-consumption-layer.mjs` 通过，覆盖 brief / email / decision / quality 产物路径、UP profile 推断、缓存失效边界、本地模型请求计划、提示词输入边界、domain 层无外部调用和基础 decision 草案；`node desktop/scripts/generate-local-consumption-samples.mjs` 通过，生成 4 个 `data/temp/local-consumption-samples` 临时样本；`npx tsc --noEmit`、`check-subtitle-only-queue-mode` 和 `check-product-refactor-surface` 继续通过。
- 本地 Ollama adapter 第二阶段检查：`node desktop/scripts/check-local-ollama-adapter.mjs` 通过，覆盖假响应、offline、timeout、HTTP error、invalid JSON、`<think>` 清理和静态红线；`node desktop/scripts/generate-local-ollama-samples.mjs --force` 使用 `shijie-qwen3-8b-q4-chat` 生成 4 个真实样本，全部 brief / email / decision / quality_check 为 `ok`；再次运行不带 `--force` 时 4 个样本全部跳过；样本输出未发现 `<think>`、本机路径、API Key、Cookie、SMTP 字样。
- 本地消费层夜间闭环检查：`node desktop/scripts/generate-local-ollama-samples.mjs --force` 使用 `shijie-qwen3-8b-q4-chat` 覆盖 7 个已有材料 UP，7 个样本全部 `ok`；再次运行不带 `--force` 时 7 个样本全部跳过；`node desktop/scripts/check-local-ollama-samples.mjs` 通过，报告 `sampleCount=7`、`okCount=7`、`failedCount=0`、`forbiddenHitCount=0`；样本产物未发现推理标签、本机路径、密钥、浏览器会话、邮件服务或授权令牌字样。
- 本地消费层正式闭环检查：`BV1MBjx6cEHw` 真实约 10 分钟视频完整跑通，材料生成 57.207 秒，本地 Ollama 消费层 18.476 秒，`local_consumption.status=ok`、`quality.riskLevel=low`；旧 `summary/article.md`、`summary/meta.json`、`summary/summary_status.json` 均未生成，`manifest.editorial_summary.status=skipped`。补充样本 `BV1toJ36aE9o` 使用新 quality 规则重跑后同样为 `status=ok`、`riskLevel=low`。
- 本地 brief / email 输出门控检查：`BV1i5jy6bECe` 中文样本只重跑本地消费层后，brief / email 均为完整 Markdown 成稿；检查确认不含“我现在需要 / 首先我会 / 用户希望 / 接下来我”等过程性文字，不在半句处截断；`decision.importance=5`，`quality.riskLevel=low`。
- 最近更新邮件转发生产化检查：`python -m py_compile src/distiller.py` 通过；`node desktop/scripts/check-mimo-cleaning-production-mode.mjs` 通过，确认生产清洗不注入 UP profile；`node desktop/scripts/check-fresh-email-delivery.mjs` 通过，覆盖 fresh dry-run、重复发送跳过、history 禁止发送、邮件关闭跳过、状态文件不含 SMTP 密码、邮件正文不附带本机材料路径和 SMTP 报错脱敏；`node desktop/scripts/check-local-consumption-layer.mjs`、`node desktop/scripts/check-local-ollama-adapter.mjs`、`node desktop/scripts/check-subtitle-only-queue-mode.mjs`、`node desktop/scripts/check-product-refactor-surface.mjs`、`check-home-dashboard-safety`、`check-up-sync-scheduler`、`check-queue-record-feed`、`check-efficiency-observability` 和 `npx tsc --noEmit` 均通过；`git diff --check` 仅有 Windows 换行提示，退出码 0。
- UI 板块切换性能检查：`node desktop/scripts/check-ui-panel-switch-performance.mjs`、`node desktop/scripts/check-home-dashboard-safety.mjs`、`node desktop/scripts/check-product-refactor-surface.mjs` 和 `npx tsc --noEmit` 均通过；浏览器预览 smoke test 未发现控制台错误。
- 桌面便携版和环境自检检查：`npm run build:portable` 通过；`node desktop/scripts/check-packaged-environment-check.mjs`、`npx tsc --noEmit`、`python -m py_compile src/distiller.py src/bilibili_api.py src/local_audio_client.py src/config.py`、`node desktop/scripts/check-subtitle-only-queue-mode.mjs`、`node desktop/scripts/check-product-refactor-surface.mjs`、`node desktop/scripts/check-home-dashboard-safety.mjs` 均通过。打包版受控启动日志只出现窗口创建和空闲检查，未发现模型、转写、邮件或 distiller 调用痕迹。
- 打包版核心页面 smoke test：`node desktop/scripts/check-packaged-portable-smoke.mjs` 通过，确认最新便携 exe 页面标题为“视界专注”，可访问最近 / 队列 / 档案 / 流程 / 设置，环境自检包含后端脚本、Python、依赖、SenseVoice、Ollama、MiMo、B 站凭据和 SMTP，且启动日志新增部分不含模型、转写、邮件或 distiller 调用。
- 便携版自动同步条幅修复检查：`node desktop/scripts/check-auto-sync-idle-backfill-loop.mjs` 通过，覆盖重复历史项不启动队列处理、真正新增且可领取的历史项仍会自动启动队列；`check-up-sync-scheduler`、`check-home-dashboard-safety`、`npx tsc --noEmit`、`npm run build:portable` 和 `check-packaged-portable-smoke` 均通过。
- 失败队列项折叠检查：`node scripts/check-folded-queue-issues.mjs`、`node scripts/check-queue-record-feed.mjs`、`node desktop/scripts/check-up-sync-scheduler.mjs`、`npx tsc --noEmit`、`npm run build:portable` 和 `node desktop/scripts/check-packaged-portable-smoke.mjs` 均通过。
- 队列与档案页 UI 密度优化检查：`node scripts/check-queue-record-feed.mjs`、`node scripts/check-archive-up-grouping.mjs`、`node scripts/check-folded-queue-issues.mjs`、`node scripts/check-efficiency-observability.mjs`、`node desktop/scripts/check-home-dashboard-safety.mjs`、`node desktop/scripts/check-product-refactor-surface.mjs`、`npx tsc --noEmit`、`npm run build:portable` 和 `node desktop/scripts/check-packaged-portable-smoke.mjs` 均通过。
- 最近视频和历史补全自动入队检查：只读统计当前 Store 队列为 200 条、196 条 `done`、4 条 `failed`、0 条可领取任务，确认满队列会阻塞旧追加策略；`node desktop/scripts/check-recent-and-history-autopilot.mjs` 通过，覆盖最近列表不再使用 24 小时时间窗、最多 9 条 fresh 候选、启动立即检查、恢复后快速检查、满队列时新增 history 任务优先保留；`node desktop/scripts/check-up-sync-scheduler.mjs`、`node desktop/scripts/check-auto-sync-idle-backfill-loop.mjs`、`node desktop/scripts/check-fresh-email-delivery.mjs`、`node desktop/scripts/check-subtitle-only-queue-mode.mjs`、`npx tsc --noEmit`、`npm run build:portable` 和 `node desktop/scripts/check-packaged-portable-smoke.mjs` 均通过；`git diff --check` 仅有 Windows 换行提示。
- 长期成品库检查：`node desktop/scripts/check-long-term-library-export.mjs` 通过，覆盖 NotebookLM / email 成品按 UP 分目录写入、标题文件名、同名短后缀、发布日期 mtime、索引去重和不删除原材料；`node desktop/scripts/migrate-materials-to-library.mjs --dry-run` 通过并显示可迁移 196 份 NotebookLM、2 份邮件稿；真实迁移后 `data/library/index.json` 为 196 条，`data/library/notebooklm` 为 196 个 Markdown，`data/library/email` 为 2 个 Markdown，`data/materials` 目录数量前后保持 1779；`node desktop/scripts/check-fresh-email-delivery.mjs`、`node desktop/scripts/check-up-sync-scheduler.mjs`、`node desktop/scripts/check-subtitle-only-queue-mode.mjs` 和 `npx tsc --noEmit` 均通过。
- 本地 Ollama 冒烟测试：`shijie-qwen3-8b-q4-chat` 在 `http://127.0.0.1:11434/api/chat` 下可用；brief 约 `7.95s`、邮件草稿约 `3.8s`、JSON 判断约 `2.63s`。运行时显示 100% GPU，context `4096`。输出可能带空 `<think>` 标签，后续 adapter 需要过滤。
- 真实自动同步运行证据：`data/logs/runtime.log` 记录 2026-06-28 21:00、22:00、23:00、2026-06-29 00:00、01:00、02:00 的准点后台检查，并产生队列处理记录。
- 数据安全核验：本轮只读统计 `data/materials` 文件数为 288；未执行删除、迁移、重命名或真实清空材料操作。
- 类型检查：`desktop` 下 `npx tsc --noEmit` 通过。
- 清晰架构迁移验证：`desktop/scripts/check-product-refactor-surface.mjs`、`desktop/scripts/check-subtitle-only-queue-mode.mjs`、`desktop/scripts/check-distill-progress.mjs` 均已在新目录下通过；简单 import 图循环检测结果为 0。
- Python 语法检查：`py_compile` 通过。
- 构建：未执行，因为会写入构建产物。
- 产品边界：下一阶段主线已调整为 UP 主驱动的字幕清洗；Summary Pipeline 暂停作为主线推进。
- 队列状态：旧 2026-06-12 启动验收时启动前后均为 53 项、全部 `done`；当前自动同步目标中已允许软件运行期间准点发现新视频并自动入队处理。
- 旧材料状态：此前测试生成的旧 `output/` 内容已按项目负责人确认删除，不再作为当前验收对象。
- 写入差异：运行日志增加；窗口状态更新；`shijie-focus-secure.json` 修改时间更新但大小和 SHA1 不变；`knowledge_library.json` 未变化。
- 启动前风险审计：旧验收确认启动只设置定时器；当前真实日志已确认运行期间准点后台检查会触发自动同步。
- 最近一次验证日期：2026-06-30。
- 最近一次独立接管评估：2026-06-12，通过。

## 新对话需要知道

- 项目根目录是 `C:\Users\Yu\AI\视界专注`。
- 项目底层工作流改造已完成；后续进入常规小步稳定化开发，但仍需按任务范围推进。
- 受控启动、来源刷新、真实 subtitle-only 小样本和清队列保护均已执行并关闭；后续真实运行继续保持小批量。
- 当前 subtitle-only 小样本已跑通，主界面阶段 1 已收束为字幕流水线，生产数据根和注册表路径已统一到 `data`。
- 旧 Markdown 集中治理已完成；不要继续扩展历史整理任务。
- 代码风险审计结果在 `docs/tasks/code-risk-audit.md`；精读稿格式契约检查和进度解析纯函数检查都已完成，不要重复做。
- 旧精读 / 邮件契约检查已退出 v1.0 subtitle-only 验证集；不要恢复为主线任务。
- `desktop/src/domain/pipeline/distillProgress.ts` 已通过纯内存检查和 TypeScript 类型检查；不要重复做同一任务。
- 当前 Git 工作区不是干净状态，存在大量未提交修改；除非用户明确要求，否则不要做 Git 写操作。
- 当前事实以代码、只读检查和项目负责人确认为准。
- 待验证问题集中放在 `docs/VERIFICATION_BACKLOG.md`。
