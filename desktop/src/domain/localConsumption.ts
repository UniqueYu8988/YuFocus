export const LOCAL_CONSUMPTION_SCHEMA_VERSION = 'shijie.local-consumption.v0.1'
export const LOCAL_BRIEF_PROMPT_VERSION = 'shijie.local-brief-prompt.v0.3'
export const LOCAL_EMAIL_PROMPT_VERSION = 'shijie.local-email-prompt.v0.3'
export const LOCAL_DECISION_PROMPT_VERSION = 'shijie.local-decision-prompt.v0.3'
export const LOCAL_QUALITY_RULE_VERSION = 'shijie.local-quality-rule.v0.5'
export const LOCAL_UP_PROFILE_VERSION = 'shijie.up-profile.v0.1'

export type LocalConsumptionArtifactKind = 'brief' | 'email' | 'decision' | 'quality_check'
export type LocalModelProviderKind = 'ollama' | 'lm_studio' | 'openai_compatible' | 'sample_generator'
export type LocalModelMessageRole = 'system' | 'user'
export type LocalModelRequestFormat = 'markdown' | 'json'
export type UpContentProfileKind = 'news_digest' | 'technical_tutorial' | 'knowledge_talk' | 'speech' | 'general'

export type LocalConsumptionProfile = {
  upId: string
  name: string
  kind: UpContentProfileKind
  profileVersion: number
  profileHash: string
  briefStyle: string
  emailStyle: string
  keep: string[]
  remove: string[]
  cautions: string[]
}

export type LocalConsumptionProfilePreset = {
  upIds: string[]
  names: string[]
  kind: UpContentProfileKind
  profileVersion: number
  briefStyle: string
  emailStyle: string
  keep: string[]
  remove: string[]
  cautions: string[]
}

export type LocalConsumptionCacheInput = {
  artifact: LocalConsumptionArtifactKind
  notebooklmSha1?: string
  rawTranscriptSha1?: string
  briefSha1?: string
  profileHash: string
  localModelName: string
  promptVersion: string
}

export type LocalConsumptionArtifactPlan = {
  schemaVersion: string
  briefPath: string
  briefMetaPath: string
  emailPath: string
  emailStatusPath: string
  decisionPath: string
  qualityCheckPath: string
}

export type LocalDecisionDraft = {
  schemaVersion: string
  worthEmail: boolean
  importance: 1 | 2 | 3 | 4 | 5
  contentType: UpContentProfileKind
  reason: string
  tags: string[]
}

export type LocalConsumptionSampleSource = {
  title: string
  creator: string
  sourceId: string
  notebooklmMarkdown: string
  profile: LocalConsumptionProfile
}

export type LocalQualityGate = {
  minNotebookToRawRatio: number
  maxMissingCriticalTerms: number
  maxMissingStepMarkers: number
}

export type LocalModelEndpointConfig = {
  provider?: LocalModelProviderKind | string
  endpoint?: string | null
  model?: string | null
  enabled?: boolean
  timeoutMs?: number | null
}

export type NormalizedLocalModelEndpoint = {
  provider: LocalModelProviderKind
  endpoint: string
  model: string
  enabled: boolean
  timeoutMs: number
}

export type LocalModelMessage = {
  role: LocalModelMessageRole
  content: string
}

export type LocalModelPromptSource = {
  artifact: LocalConsumptionArtifactKind
  title: string
  creator: string
  sourceId: string
  notebooklmMarkdown?: string
  briefMarkdown?: string
  rawTranscriptText?: string
  profile: LocalConsumptionProfile
  criticalTerms?: string[]
  cacheKey?: string
  contentBudgetChars?: number
}

export type LocalModelRequestPlan = {
  schemaVersion: string
  artifact: LocalConsumptionArtifactKind
  promptVersion: string
  provider: LocalModelProviderKind
  endpoint: string
  model: string
  responseFormat: LocalModelRequestFormat
  timeoutMs: number
  cacheKey?: string
  messages: LocalModelMessage[]
}

export const LOCAL_CONSUMPTION_ARTIFACT_PLAN: LocalConsumptionArtifactPlan = {
  schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
  briefPath: 'exports/brief.local.md',
  briefMetaPath: 'work/brief/local_brief.meta.json',
  emailPath: 'delivery/email.md',
  emailStatusPath: 'delivery/email_status.json',
  decisionPath: 'delivery/decision.json',
  qualityCheckPath: 'work/quality/local_check.json',
}

export const DEFAULT_LOCAL_QUALITY_GATE: LocalQualityGate = {
  minNotebookToRawRatio: 0.55,
  maxMissingCriticalTerms: 0,
  maxMissingStepMarkers: 0,
}

export const DEFAULT_LOCAL_MODEL_TIMEOUT_MS = 300000
export const DEFAULT_LOCAL_MODEL_ENDPOINTS: Record<LocalModelProviderKind, string> = {
  ollama: 'http://127.0.0.1:11434/api/chat',
  lm_studio: 'http://127.0.0.1:1234/v1/chat/completions',
  openai_compatible: 'http://127.0.0.1:1234/v1/chat/completions',
  sample_generator: 'local://sample-generator',
}

export const DEFAULT_LOCAL_MODEL_NAMES: Record<LocalModelProviderKind, string> = {
  ollama: 'local-model-unconfigured',
  lm_studio: 'local-model-unconfigured',
  openai_compatible: 'local-model-unconfigured',
  sample_generator: 'sample-generator',
}

export const LOCAL_UP_PROFILE_PRESETS: LocalConsumptionProfilePreset[] = [
  {
    upIds: ['285286947'],
    names: ['橘鸦juya', '橘鸦'],
    kind: 'news_digest',
    profileVersion: 1,
    briefStyle: '按 AI 新闻条目输出，逐条保留主体、动作、模型/产品名、版本号、价格、额度、时间、链接线索和可能影响；不同新闻不要合并。',
    emailStyle: '生成短而密的 AI 日报，先列最值得关注的 3-5 条，再给出“为什么值得看”和“后续可追踪点”。',
    keep: ['公司名', '产品名', '模型名', '版本号', '价格', '额度', '日期', '政策变化', '发布状态', '影响对象', '链接线索'],
    remove: ['片头寒暄', '背景音乐提示', '重复播报', '无意义转场', '点赞关注话术', '广告口播', '明显识别乱码'],
    cautions: ['不得合并不同新闻条目', '模型名和公司名不确定时保留原文并标注不确定', '不得用行业常识补全缺失事实', '广告或口播福利只在与主体信息有关时保留'],
  },
  {
    upIds: ['316183842'],
    names: ['技术爬爬虾'],
    kind: 'technical_tutorial',
    profileVersion: 1,
    briefStyle: '保留教程结构、工具名、安装/配置步骤、命令、路径、按钮、报错处理、适用场景和前置条件；输出应像可复现的操作笔记。',
    emailStyle: '说明这期教程适合谁、解决什么具体问题、核心操作路径、容易踩坑处，以及是否值得完整回看。',
    keep: ['操作步骤', '工具名', '版本', '网址', '命令', '代码', '按钮名称', '配置项', '路径', '前置条件', '错误处理', '替代方案'],
    remove: ['重复铺垫', '口癖', '无意义寒暄', '重复演示说明', '非必要情绪表达'],
    cautions: ['不得把步骤改写成概念总结', '不得删除命令、按钮、路径和配置项', '不确定术语保持原文', '教程顺序不能打乱'],
  },
  {
    upIds: ['3546593938639500'],
    names: ['罗胖罗振宇', '罗振宇'],
    kind: 'knowledge_talk',
    profileVersion: 1,
    briefStyle: '保留核心判断、论证链、历史线索、人物/机构、例子、类比、转折和限定条件；不要把长论证压扁成一句鸡汤。',
    emailStyle: '输出观点简报：核心判断、论证链、值得记住的例子、可迁移启发和需要保留的限定条件。',
    keep: ['核心判断', '论据', '历史人物', '机构', '案例', '类比', '因果链', '转折', '限定条件', '可迁移启发'],
    remove: ['重复口播', '过长铺垫', '无信息量转场', '口头禅', '过度礼貌语'],
    cautions: ['不得删除反例和限定条件', '保留作者观点方向但不要替作者下新结论', '历史人物和年份不确定时标注不确定'],
  },
  {
    upIds: ['316568752'],
    names: ['马督工', '睡前消息'],
    kind: 'knowledge_talk',
    profileVersion: 1,
    briefStyle: '按公共议题拆解：问题是什么、涉及哪些主体、关键数据/政策/产业链证据、利益关系、作者判断和可能后果。',
    emailStyle: '输出问题-证据-结论式简报，帮助快速判断这期公共议题是否值得深读。',
    keep: ['公共议题', '政策', '数据', '地区', '行业', '利益主体', '因果链', '作者判断', '反例', '后果'],
    remove: ['重复设问', '情绪化转场', '口号式表达', '节目固定寒暄', '无信息量调侃'],
    cautions: ['不得把复杂因果链简化成单一立场', '争议性判断要保留证据来源语境', '数字和地区名称必须谨慎保留'],
  },
  {
    upIds: ['1556651916'],
    names: ['小黛晨读'],
    kind: 'news_digest',
    profileVersion: 1,
    briefStyle: '按参考信息条目输出，逐条保留主体、事件、争议点、关键数字、政策/监管信息、潜在影响；避免新闻间误合并。',
    emailStyle: '生成社会资讯速读：最值得关注的条目、每条的关键变化、可能影响和后续观察点。',
    keep: ['事件主体', '地点', '机构', '政策', '监管动作', '关键数字', '争议点', '影响人群', '后续进展'],
    remove: ['寒暄', '固定栏目口播', '重复转场', '无意义感叹', '明显识别噪声'],
    cautions: ['不得混淆不同社会新闻', '涉及法律/监管时不要自行定性', '地名、人名、机构名不确定时保留不确定标注'],
  },
  {
    upIds: ['383382980'],
    names: ['杨彧鑫ai', '杨彧鑫', '杨曦鑫ai'],
    kind: 'knowledge_talk',
    profileVersion: 1,
    briefStyle: '保留 AI 商业判断、Agent 方法框架、案例、可执行动作、风险提示和作者对未来趋势的判断。',
    emailStyle: '输出 AI 商业/Agent 观察简报：核心判断、方法框架、可执行启发、适合继续研究的问题。',
    keep: ['商业判断', 'Agent 方法', '案例', '步骤', '指标', '趋势判断', '风险', '行动建议', '工具或模型名'],
    remove: ['标题党重复', '泛泛鸡汤', '过度铺垫', '无信息量口播', '重复类比'],
    cautions: ['不得把观点包装成事实', '商业预测要保留限定条件', '方法框架不能压缩到只剩口号'],
  },
  {
    upIds: ['256724889'],
    names: ['ted官方精选', 'ted'],
    kind: 'speech',
    profileVersion: 1,
    briefStyle: '保留演讲故事线、问题提出、实验/案例、核心观点、转折、比喻和可引用表达；保留情绪线但去掉舞台噪声。',
    emailStyle: '输出演讲阅读简报：主题、故事线、核心启发、可引用观点和是否值得完整观看。',
    keep: ['故事线', '核心观点', '实验', '案例', '数据', '转折', '比喻', '可引用表达', '启发'],
    remove: ['掌声', '舞台提示', '寒暄', '重复表达', '字幕残留噪声'],
    cautions: ['不得重新发明演讲观点', '不要把故事完全压成抽象结论', '保留关键人物和场景细节'],
  },
  {
    upIds: ['280780745'],
    names: ['张小强商业访谈录', '商业访谈'],
    kind: 'knowledge_talk',
    profileVersion: 1,
    briefStyle: '按访谈结构保留嘉宾身份、行业背景、问题、回答观点、案例、商业模式和可验证数字。',
    emailStyle: '输出商业访谈简报：嘉宾观点、行业判断、可迁移经验和需要继续核实的信息。',
    keep: ['嘉宾身份', '行业', '商业模式', '案例', '数据', '问题', '回答观点', '经验教训', '风险'],
    remove: ['寒暄', '客套', '重复追问', '无信息量转场', '广告口播'],
    cautions: ['不得把主持人问题和嘉宾回答混为一谈', '商业数字不确定时标注不确定', '保留不同观点之间的分歧'],
  },
]

export function normalizeLocalModelName(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  return normalized || 'local-model-unconfigured'
}

export function normalizeLocalModelProvider(value: string | null | undefined): LocalModelProviderKind {
  const normalized = String(value || '').trim().toLocaleLowerCase('en-US').replace(/[\s-]+/gu, '_')
  if (normalized === 'ollama') return 'ollama'
  if (normalized === 'lm_studio' || normalized === 'lmstudio') return 'lm_studio'
  if (normalized === 'openai_compatible' || normalized === 'openai') return 'openai_compatible'
  if (normalized === 'sample_generator' || normalized === 'sample') return 'sample_generator'
  return 'sample_generator'
}

export function normalizeLocalModelEndpoint(config: LocalModelEndpointConfig = {}): NormalizedLocalModelEndpoint {
  const provider = normalizeLocalModelProvider(config.provider)
  return {
    provider,
    endpoint: String(config.endpoint || '').trim() || DEFAULT_LOCAL_MODEL_ENDPOINTS[provider],
    model: normalizeLocalModelName(config.model || DEFAULT_LOCAL_MODEL_NAMES[provider]),
    enabled: Boolean(config.enabled),
    timeoutMs: Math.max(1000, Number(config.timeoutMs || DEFAULT_LOCAL_MODEL_TIMEOUT_MS)),
  }
}

export function buildLocalConsumptionCacheKey(input: LocalConsumptionCacheInput) {
  const notebooklmSha1 = input.notebooklmSha1 || 'no-notebooklm'
  const rawTranscriptSha1 = input.rawTranscriptSha1 || 'no-raw'
  const briefSha1 = input.briefSha1 || 'no-brief'
  return [
    LOCAL_CONSUMPTION_SCHEMA_VERSION,
    input.artifact,
    input.promptVersion,
    input.profileHash,
    normalizeLocalModelName(input.localModelName),
    notebooklmSha1,
    rawTranscriptSha1,
    briefSha1,
  ].join('|')
}

export function getPromptVersionForArtifact(artifact: LocalConsumptionArtifactKind) {
  if (artifact === 'brief') return LOCAL_BRIEF_PROMPT_VERSION
  if (artifact === 'email') return LOCAL_EMAIL_PROMPT_VERSION
  if (artifact === 'decision') return LOCAL_DECISION_PROMPT_VERSION
  return LOCAL_QUALITY_RULE_VERSION
}

export function buildLocalModelRequestPlan(
  source: LocalModelPromptSource,
  endpointConfig: LocalModelEndpointConfig = {},
): LocalModelRequestPlan {
  const endpoint = normalizeLocalModelEndpoint(endpointConfig)
  const promptVersion = getPromptVersionForArtifact(source.artifact)
  const responseFormat = source.artifact === 'brief' || source.artifact === 'email' ? 'markdown' : 'json'
  return {
    schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
    artifact: source.artifact,
    promptVersion,
    provider: endpoint.provider,
    endpoint: endpoint.endpoint,
    model: endpoint.model,
    responseFormat,
    timeoutMs: endpoint.timeoutMs,
    cacheKey: source.cacheKey,
    messages: [
      {
        role: 'system',
        content: renderLocalModelSystemPrompt(source.profile),
      },
      {
        role: 'user',
        content: renderLocalModelUserPrompt(source),
      },
    ],
  }
}

export function renderLocalModelSystemPrompt(profile: LocalConsumptionProfile) {
  return [
    '你是“视界专注”的本地消费层模型，只处理已经生成的主资料，不负责下载、转写或改写 NotebookLM 主资料。',
    '目标是把已经由 MiMo 高保真清洗过的主资料整理成高信息密度简报；可以压缩表达，但不能牺牲关键事实、数字、人物、案例、因果链和作者判断。',
    `UP 主类型：${profile.kind}`,
    `简报风格：${profile.briefStyle}`,
    `邮件风格：${profile.emailStyle}`,
    `必须保留：${profile.keep.join('、')}`,
    `可以过滤：${profile.remove.join('、')}`,
    `注意事项：${profile.cautions.join('；')}`,
    '事实纪律：不要编造原文没有的事实；不要创造主资料中没有的精确日期、数字、商品规格、价格、人物结论；不确定内容保留并标注“不确定”。',
    '输出纪律：不要输出思考过程、执行计划、提示词分析、用户需求分析、<think> 标签或“我将如何处理”。',
  ].join('\n')
}

export function renderLocalModelUserPrompt(source: LocalModelPromptSource) {
  const header = [
    `标题：${source.title || '未知标题'}`,
    `UP 主：${source.creator || source.profile.name || '未知 UP'}`,
    `来源编号：${source.sourceId || '未知'}`,
    `目标产物：${source.artifact}`,
  ].join('\n')

  if (source.artifact === 'brief') {
    return [
      header,
      '',
      '请根据下面的 NotebookLM 主资料生成“事实门控版高信息密度简报”。',
      '它不是 NotebookLM 主资料本身，而是给人快速阅读和邮件推送使用的总结稿。',
      '硬性要求：',
      '- 保留关键事实、观点、步骤、案例、数字、日期、专有名词、人物、机构、作者判断和因果链。',
      '- 可以压缩语言，但不能只抓一个主线；如果视频有多个实质主题，必须分开呈现。',
      '- 低价值广告、固定寒暄和结尾提醒可以压缩为一句，但不要假装它们不存在。',
      '- 禁止新增主资料没有的精确日期、数字、商品颜色、价格、克重、人物结论或政策名。',
      '- 禁止把复杂立场二元化；有争议判断时保留作者的限定条件。',
      '- 只输出最终 Markdown 成稿，不要输出你的阅读过程、计划、分析步骤或“我将如何处理”。',
      '建议结构：# 本地总结稿；## 一句话结论；## 1. 主要议题；## 2. 关键事实与案例；## 3. 作者判断；## 4. 可以沉淀到知识库的要点；## 5. 低价值但需保留的信息。',
      '篇幅要求：通常 1200-2200 个中文字符；如果资料较短，也必须输出完整段落，不能在半句话处结束。',
      '',
      'NotebookLM 主资料：',
      clipForLocalModel(stripNotebookLmMetadata(source.notebooklmMarkdown || ''), source.contentBudgetChars),
    ].join('\n')
  }

  if (source.artifact === 'email') {
    return [
      header,
      '',
      '请只根据下面的本地简报生成一封可直接发送的邮件正文。',
      '邮件是 brief 的轻包装，不是第二次总结；不要补充简报之外的新事实，不要编造日期、数字、人物结论或商品信息。',
      '只输出最终邮件 Markdown，不要输出你的阅读过程、计划、分析步骤或“我将如何处理”。',
      '建议结构：# 视频更新；开头 1 段说明为什么值得看；随后列出 3-6 个高密度要点；最后给出是否值得完整回看的判断。',
      '篇幅要求：500-1200 个中文字符；必须完整收尾，不能在半句话处结束。',
      '',
      '本地简报：',
      clipForLocalModel(source.briefMarkdown || '', source.contentBudgetChars),
    ].join('\n')
  }

  if (source.artifact === 'decision') {
    return [
      header,
      '',
      '请判断这条视频是否值得生成邮件推送。你必须只输出一个 JSON 对象，不要输出 Markdown，不要输出解释，不要输出 role/content/status/data 等外层包装。',
      'JSON schema：{"worthEmail":boolean,"importance":1|2|3|4|5,"reason":"60字以内中文原因","tags":["1到4个短标签"]}。',
      'importance 含义：1=低价值，3=可读，5=非常值得推送。',
      '示例：{"worthEmail":true,"importance":4,"reason":"教程步骤清晰，适合后续回看。","tags":["technical_tutorial","Git"]}',
      '',
      '判断依据只来自下面的主资料摘录和 UP 主 profile，不要读取外部信息：',
      clipForLocalModel(stripNotebookLmMetadata(source.notebooklmMarkdown || ''), Math.min(source.contentBudgetChars || 3000, 3000)),
      '',
      '最终只输出 JSON：{"worthEmail":boolean,"importance":1|2|3|4|5,"reason":"60字以内中文原因","tags":["1到4个短标签"]}',
    ].join('\n')
  }

  return [
    header,
    '',
    '请做本地质量检查。你必须只输出一个 JSON 对象，不要输出 Markdown，不要复述原文，不要总结视频内容，不要输出 role/content/status/data 等外层包装。',
    'JSON schema：{"ok":boolean,"riskLevel":"low|medium|high","issues":["问题短句"],"missingCriticalTerms":["缺失术语"],"reason":"80字以内中文原因"}。',
    '只检查主资料是否明显过短，是否漏掉关键数字、日期、专有名词或教程步骤；无法确认缺失时不要臆测。',
    'missingCriticalTerms 只能填写“关键术语候选”里已经给出的原词，不能自行翻译、改写、补英文或补中文；如果候选词不在原始字幕摘录中，也不要判缺失。',
    'riskLevel=high 只用于主资料明显无法使用的情况：例如大段原始字幕消失、关键步骤整体缺失、或候选关键术语多项在原始字幕中出现但在主资料中缺失。',
    '如果只是简报可读性一般、信息组织松散、或你希望有更多案例，但无法证明主资料遗漏，则 ok=true 且 riskLevel=low/medium。',
    '示例：{"ok":true,"riskLevel":"low","issues":[],"missingCriticalTerms":[],"reason":"主资料覆盖了核心步骤和关键术语。"}',
    `关键术语候选：${(source.criticalTerms || []).join('、') || '无'}`,
    '',
    '原始字幕摘录：',
    clipForLocalModel(source.rawTranscriptText || '', Math.min(source.contentBudgetChars || 3000, 3000)),
    '',
    'NotebookLM 主资料摘录：',
    clipForLocalModel(stripNotebookLmMetadata(source.notebooklmMarkdown || ''), Math.min(source.contentBudgetChars || 3000, 3000)),
    '',
    '最终只输出 JSON：{"ok":boolean,"riskLevel":"low|medium|high","issues":["问题短句"],"missingCriticalTerms":["缺失术语"],"reason":"80字以内中文原因"}',
  ].join('\n')
}

export function clipForLocalModel(text: string, budgetChars = 28000) {
  const normalized = String(text || '').trim()
  const safeBudget = Math.max(1000, Math.floor(budgetChars))
  if (normalized.length <= safeBudget) return normalized
  return `${normalized.slice(0, safeBudget)}\n\n[内容因本地模型输入预算被截断，后续版本应使用分段处理。]`
}

export function createDefaultLocalConsumptionProfile(options: {
  upId: string
  name: string
  kind?: UpContentProfileKind
  profileHash?: string
  profileVersion?: number
}): LocalConsumptionProfile {
  const preset = findLocalConsumptionProfilePreset(options)
  const kind = options.kind || preset?.kind || inferUpContentProfileKind(options.name)
  const base = preset || profilePreset(kind)
  const profileVersion = options.profileVersion ?? preset?.profileVersion ?? 1
  const profileHash = options.profileHash || buildLocalConsumptionProfileHash({
    upId: options.upId,
    name: options.name,
    kind,
    profileVersion,
    preset,
  })
  return {
    upId: options.upId,
    name: options.name,
    kind,
    profileVersion,
    profileHash,
    briefStyle: base.briefStyle,
    emailStyle: base.emailStyle,
    keep: [...base.keep],
    remove: [...base.remove],
    cautions: [...base.cautions],
  }
}

export function findLocalConsumptionProfilePreset(options: {
  upId?: string | null
  name?: string | null
}) {
  const upId = String(options.upId || '').trim()
  const normalizedName = normalizeProfileName(options.name)
  return LOCAL_UP_PROFILE_PRESETS.find((preset) => {
    if (upId && preset.upIds.includes(upId)) return true
    if (!normalizedName) return false
    return preset.names.some((name) => normalizedName.includes(normalizeProfileName(name)))
  })
}

export function buildLocalConsumptionProfileHash(options: {
  upId?: string | null
  name?: string | null
  kind: UpContentProfileKind
  profileVersion: number
  preset?: LocalConsumptionProfilePreset
}) {
  const upId = String(options.upId || 'unknown').trim() || 'unknown'
  const name = normalizeProfileName(options.name) || 'unknown'
  const presetKey = options.preset
    ? [...options.preset.upIds, ...options.preset.names].join(',')
    : 'fallback'
  return [
    LOCAL_UP_PROFILE_VERSION,
    upId,
    name,
    options.kind,
    `v${options.profileVersion}`,
    presetKey,
  ].join('|')
}

export function normalizeProfileName(name: string | null | undefined) {
  return String(name || '')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, '')
}

export function inferUpContentProfileKind(name: string): UpContentProfileKind {
  const normalized = normalizeProfileName(name)
  if (normalized.includes('橘鸦') || normalized.includes('早报') || normalized.includes('juya')) return 'news_digest'
  if (normalized.includes('技术') || normalized.includes('爬爬虾') || normalized.includes('ai')) return 'technical_tutorial'
  if (normalized.includes('罗胖') || normalized.includes('罗振宇')) return 'knowledge_talk'
  if (normalized.includes('ted')) return 'speech'
  return 'general'
}

export function profilePreset(kind: UpContentProfileKind) {
  if (kind === 'news_digest') {
    return {
      briefStyle: '按新闻条目输出，突出主体、动作、数字、版本、价格、影响和是否值得关注。',
      emailStyle: '生成短而密的信息日报，优先列出最值得关注的 3-5 条。',
      keep: ['公司名', '产品名', '模型名', '日期', '价格', '版本', '政策变化', '关键影响'],
      remove: ['片头寒暄', '背景音乐提示', '重复播报', '无意义转场', '点赞关注话术', '明显识别乱码'],
      cautions: ['不得合并不同新闻条目', '不确定的识别内容保留并标注不确定', '不得用常识补全缺失事实'],
    }
  }

  if (kind === 'technical_tutorial') {
    return {
      briefStyle: '保留教程结构、操作步骤、按钮、命令、软件名、路径和错误处理；只压缩重复铺垫。',
      emailStyle: '说明视频适合谁看、解决什么问题、核心步骤和需要完整回看的位置。',
      keep: ['操作步骤', '命令', '代码', '按钮名称', '软件名', '路径', '前置条件', '错误处理'],
      remove: ['重复铺垫', '口癖', '无意义寒暄', '重复演示说明'],
      cautions: ['不得把步骤改写成概念总结', '不得删除命令和按钮路径', '不确定术语保持原文'],
    }
  }

  if (kind === 'knowledge_talk') {
    return {
      briefStyle: '保留核心判断、论据、案例、历史人物、因果链、转折和限定条件。',
      emailStyle: '输出一封观点简报：核心判断、论证链、值得记住的案例和对我的启发。',
      keep: ['核心判断', '论据', '案例', '人物', '机构', '因果链', '转折', '限定条件'],
      remove: ['重复口播', '过长铺垫', '无信息量转场', '口头禅'],
      cautions: ['不得把长论证压成一句结论', '不得删除反例和限定条件', '保留作者观点方向'],
    }
  }

  if (kind === 'speech') {
    return {
      briefStyle: '保留演讲故事线、核心观点、论证转折、案例和可引用表达。',
      emailStyle: '输出演讲阅读简报：主题、故事线、核心启发和可引用观点。',
      keep: ['故事线', '核心观点', '案例', '转折', '比喻', '可引用表达'],
      remove: ['掌声', '寒暄', '重复表达', '舞台提示'],
      cautions: ['不得重新发明演讲观点', '保留故事中的关键细节', '不要把情绪线完全抹掉'],
    }
  }

  return {
    briefStyle: '生成忠实的资料简报，保留事实、观点、步骤、案例和关键细节。',
    emailStyle: '生成可快速阅读的邮件稿，说明内容价值、核心要点和是否值得回看。',
    keep: ['事实', '观点', '步骤', '案例', '数字', '日期', '专有名词'],
    remove: ['寒暄', '重复口癖', '无意义转场', '明显识别噪声'],
    cautions: ['不得新增原文没有的结论', '不得删除关键数字和专有名词', '不确定内容保留并标注'],
  }
}

export function createLocalDecisionDraft(options: {
  profile: LocalConsumptionProfile
  hasNotebooklm: boolean
  textLength: number
  issueCount?: number
}): LocalDecisionDraft {
  const issueCount = options.issueCount ?? 0
  const importance = Math.max(1, Math.min(5, Math.round(options.textLength / 12000) + 2 - Math.min(issueCount, 2))) as 1 | 2 | 3 | 4 | 5
  return {
    schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
    worthEmail: options.hasNotebooklm && importance >= 3 && issueCount <= 1,
    importance,
    contentType: options.profile.kind,
    reason: options.hasNotebooklm
      ? `已生成 NotebookLM 主资料，可按「${options.profile.emailStyle}」生成本地邮件稿。`
      : '尚未生成 NotebookLM 主资料，暂不进入消费层。',
    tags: [options.profile.kind, options.profile.name].filter(Boolean),
  }
}

export function stripNotebookLmMetadata(markdown: string) {
  const marker = '\n## 正文'
  const markerIndex = markdown.indexOf(marker)
  if (markerIndex < 0) return markdown.trim()
  return markdown.slice(markerIndex + marker.length).trim()
}

export function selectLocalBriefSeedParagraphs(markdown: string, limit = 6) {
  return stripNotebookLmMetadata(markdown)
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith('# '))
    .slice(0, limit)
}

export function renderLocalBriefSample(source: LocalConsumptionSampleSource) {
  const paragraphs = selectLocalBriefSeedParagraphs(source.notebooklmMarkdown, 6)
  const points = paragraphs.map((paragraph, index) => `${index + 1}. ${paragraph.replace(/\s+/gu, ' ').slice(0, 220)}`)
  return [
    `# ${source.title}`,
    '',
    '## 本地简报样本',
    '',
    `- UP 主：${source.creator || source.profile.name || '未知'}`,
    `- 来源：${source.sourceId || '未获取'}`,
    `- 策略：${source.profile.kind}`,
    `- 简报风格：${source.profile.briefStyle}`,
    '',
    '## 预览要点',
    '',
    ...points,
    '',
    '## 后续本地模型应重点保留',
    '',
    ...source.profile.keep.map((item) => `- ${item}`),
    '',
    '## 后续本地模型应过滤',
    '',
    ...source.profile.remove.map((item) => `- ${item}`),
  ].join('\n')
}

export function renderLocalEmailSample(source: LocalConsumptionSampleSource, briefMarkdown: string) {
  const preview = briefMarkdown
    .split(/\n/u)
    .filter((line) => /^\d+\.\s/u.test(line))
    .slice(0, 5)
  return [
    `# ${source.profile.name || source.creator}｜${source.title}`,
    '',
    '这是一封本地消费层邮件样本，用来验证结构；正式版本应由本地模型根据 brief 生成。',
    '',
    '## 为什么值得看',
    '',
    source.profile.emailStyle,
    '',
    '## 快速要点',
    '',
    ...preview,
  ].join('\n')
}

export function createLocalQualityCheckDraft(options: {
  rawTextLength: number
  notebookTextLength: number
  criticalTerms: string[]
  missingCriticalTerms?: string[]
  gate?: LocalQualityGate
}) {
  const gate = options.gate || DEFAULT_LOCAL_QUALITY_GATE
  const ratio = options.rawTextLength > 0 ? options.notebookTextLength / options.rawTextLength : 0
  const missingCriticalTerms = options.missingCriticalTerms || []
  return {
    schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
    ruleVersion: LOCAL_QUALITY_RULE_VERSION,
    ok: ratio >= gate.minNotebookToRawRatio && missingCriticalTerms.length <= gate.maxMissingCriticalTerms,
    notebookToRawRatio: Number(ratio.toFixed(4)),
    criticalTermCount: options.criticalTerms.length,
    missingCriticalTerms,
    gate,
  }
}
