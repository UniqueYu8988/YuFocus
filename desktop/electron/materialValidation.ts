import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export type MaterialValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export type MaterialValidationReport = {
  schema_version: 'shijie.material-validation.v0.2'
  generated_at: string
  material_id: string
  material_path: string
  stage: string
  semantic_status: string
  validation_status: 'passed' | 'failed' | 'not_ready'
  contract_version: string
  contract_mode: string
  profile: string
  pipeline_ready: boolean
  legacy_validation_passed: boolean
  upgrade_required_for_pipeline_ready: boolean
  audit_ready: boolean
  release_ready: boolean
  repair_intent: string
  blocking_reasons: Array<{
    code: string
    severity: 'blocking'
    message: string
    repair_intent: string
    path?: string
  }>
  summary: {
    error_count: number
    warning_count: number
    learning_notes_chars: number
    learning_notes_plain_chars: number
    chapter_count: number
    section_count: number
    shortest_section_chars: number
    median_section_chars: number
    short_section_count: number
    short_section_ratio: number
    minimum_learning_notes_plain_chars: number
    required_topic_count: number
    long_material: boolean
    source_index_entries: number
    learning_notes_trace_links: number
    chapter_mindmap_trace_links: number
    learning_page_plan_units: number
    candidate_source_card_count: number
    required_source_card_count: number
    published_claim_count: number
    quality_audit_report_exists: boolean
    quality_audit_result: string
  }
  issues: MaterialValidationIssue[]
}

type ValidationProfile = {
  contract_version: string
  profile: string
  mode: string
  capabilities: Record<string, 'optional' | 'required'>
  required_checks: string[]
  length_policy: {
    absolute_floor: number
    raw_ratio_floor: number
    min_chars_per_h3: number
    min_chars_per_required_topic: number
    short_h3_threshold: number
    short_h3_ratio_limit: number
    h3_median_floor: number
  }
  h3_policy?: {
    target_range?: [number, number]
    soft_max?: number
    hard_max?: number
  }
  published_rubric?: {
    required_slots?: string[]
  }
}

type ValidationContract = ValidationProfile & {
  schema_version: string
  material_id: string
  profile_source?: string
  profile_hash?: string
  resolved_at: string
  upgrade_available?: boolean
  resolved_rules?: Record<string, unknown>
}

const CONTRACT_PATH = 'validation_contract.json'
const VALIDATION_REPORT_PATH = 'content_draft/review_exports/validation_report.json'

const DEFAULT_PROFILES: Record<string, ValidationProfile> = {
  lecture: {
    contract_version: 'v8.2',
    profile: 'lecture',
    mode: 'strict',
    capabilities: {
      learning_page_plan: 'required',
      candidate_source_cards: 'required',
      required_source_cards: 'required',
      published_claims: 'required',
    },
    required_checks: [
      'material_structure',
      'student_visible_artifacts_exist',
      'student_text_clean',
      'long_material_sanity_floor',
      'learning_units_too_short',
      'ready_state_layering',
    ],
    length_policy: {
      absolute_floor: 12_000,
      raw_ratio_floor: 0.04,
      min_chars_per_h3: 700,
      min_chars_per_required_topic: 180,
      short_h3_threshold: 400,
      short_h3_ratio_limit: 0.25,
      h3_median_floor: 700,
    },
  },
  technical_tutorial: {
    contract_version: 'v8.2',
    profile: 'technical_tutorial',
    mode: 'strict',
    capabilities: {
      learning_page_plan: 'required',
      candidate_source_cards: 'required',
      required_source_cards: 'required',
      published_claims: 'required',
    },
    required_checks: [
      'material_structure',
      'student_visible_artifacts_exist',
      'student_text_clean',
      'long_material_sanity_floor',
      'learning_units_too_short',
      'ready_state_layering',
    ],
    length_policy: {
      absolute_floor: 18_000,
      raw_ratio_floor: 0.06,
      min_chars_per_h3: 900,
      min_chars_per_required_topic: 250,
      short_h3_threshold: 600,
      short_h3_ratio_limit: 0.2,
      h3_median_floor: 900,
    },
  },
  medical_exam: {
    contract_version: 'v8.2',
    profile: 'medical_exam',
    mode: 'strict',
    capabilities: {
      learning_page_plan: 'required',
      candidate_source_cards: 'required',
      required_source_cards: 'required',
      published_claims: 'required',
    },
    required_checks: [
      'material_structure',
      'student_visible_artifacts_exist',
      'student_text_clean',
      'long_material_sanity_floor',
      'learning_units_too_short',
      'ready_state_layering',
    ],
    length_policy: {
      absolute_floor: 36_000,
      raw_ratio_floor: 0.1,
      min_chars_per_h3: 1_200,
      min_chars_per_required_topic: 350,
      short_h3_threshold: 800,
      short_h3_ratio_limit: 0.15,
      h3_median_floor: 1_200,
    },
    h3_policy: {
      target_range: [20, 35],
      soft_max: 35,
      hard_max: 45,
    },
    published_rubric: {
      required_slots: [
        'definition_or_positioning',
        'mechanism_or_reasoning',
        'exam_trigger',
        'boundary_or_exception',
        'example_or_review_question',
        'traceable',
      ],
    },
  },
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  const trimmed = text.replace(/\s+/gu, ' ').trim()
  return trimmed || fallback
}

function readJsonDocument(documentPath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(documentPath)) return null
    const parsed = JSON.parse(fs.readFileSync(documentPath, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function writeJsonIfChanged(documentPath: string, payload: unknown) {
  const nextText = `${JSON.stringify(payload, null, 2)}\n`
  try {
    if (fs.existsSync(documentPath) && fs.readFileSync(documentPath, 'utf-8') === nextText) return
  } catch {
    // Fall through and rewrite.
  }
  fs.mkdirSync(path.dirname(documentPath), { recursive: true })
  fs.writeFileSync(documentPath, nextText, 'utf-8')
}

function stripMarkdownForValidation(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/gu, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/[|*_>#-]/gu, ' ')
    .replace(/\s+/gu, '')
}

function collectMarkdownHeadings(markdown: string) {
  return Array.from(markdown.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gmu)).map((match) => ({
    level: match[1].length,
    title: match[2].trim(),
    index: match.index ?? 0,
  }))
}

function collectHeadingBodyLengths(markdown: string, headingLevel: number) {
  const headingPattern = new RegExp(`^#{${headingLevel}}\\s+(.+?)\\s*#*\\s*$`, 'gmu')
  const headings = Array.from(markdown.matchAll(headingPattern)).map((match) => ({
    title: match[1].trim(),
    index: match.index ?? 0,
  }))
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? markdown.length
    const body = markdown.slice(heading.index, end)
    return {
      title: heading.title,
      chars: stripMarkdownForValidation(body).length,
    }
  })
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function readSourceIndexSummary(documentPath: string) {
  const entryIds = new Set<string>()
  const blockIds = new Set<string>()
  let invalidLineCount = 0
  if (!fs.existsSync(documentPath)) return { entryCount: 0, invalidLineCount, entryIds, blockIds }
  try {
    const lines = fs.readFileSync(documentPath, 'utf-8').split(/\r?\n/u).filter((line) => line.trim())
    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as Record<string, unknown>
        const entryId = sanitizeDisplayText(payload.entry_id ?? '')
        const blockId = sanitizeDisplayText(payload.block_id ?? '')
        if (entryId) entryIds.add(entryId)
        if (blockId) blockIds.add(blockId)
      } catch {
        invalidLineCount += 1
      }
    }
    return { entryCount: lines.length, invalidLineCount, entryIds, blockIds }
  } catch {
    return { entryCount: 0, invalidLineCount: 1, entryIds, blockIds }
  }
}

function readTraceMapLinks(documentPath: string) {
  const payload = readJsonDocument(documentPath)
  if (!payload || !Array.isArray(payload.links)) return []
  return payload.links.filter((link): link is Record<string, unknown> => Boolean(link && typeof link === 'object' && !Array.isArray(link)))
}

function listFilesRecursive(directoryPath: string, extensions: string[]) {
  const files: string[] = []
  if (!fs.existsSync(directoryPath)) return files
  const normalizedExtensions = new Set(extensions.map((extension) => extension.toLowerCase()))
  const visit = (currentPath: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = []
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        visit(nextPath)
        continue
      }
      if (entry.isFile() && normalizedExtensions.has(path.extname(entry.name).toLowerCase())) files.push(nextPath)
    }
  }
  visit(directoryPath)
  return files
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  }
  return []
}

function collectStructuredRecords(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return asRecordArray(value)
  const record = value as Record<string, unknown>
  const directCollections = [
    record.pages,
    record.learning_pages,
    record.learning_units,
    record.sections,
    record.units,
    record.cards,
    record.source_cards,
    record.claims,
  ]
  for (const collection of directCollections) {
    const records = asRecordArray(collection)
    if (records.length > 0) return records
  }
  return [record]
}

function readJsonlRecords(filePath: string) {
  const records: Record<string, unknown>[] = []
  let invalidLineCount = 0
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/u)
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          records.push(parsed as Record<string, unknown>)
        } else {
          invalidLineCount += 1
        }
      } catch {
        invalidLineCount += 1
      }
    }
  } catch {
    invalidLineCount += 1
  }
  return { records, invalidLineCount }
}

function readStructuredRecordsFromDirectory(directoryPath: string, extensions: string[]) {
  const files = listFilesRecursive(directoryPath, extensions)
  const records: Record<string, unknown>[] = []
  let invalidFileCount = 0
  let invalidLineCount = 0
  for (const filePath of files) {
    try {
      if (filePath.toLowerCase().endsWith('.jsonl')) {
        const parsed = readJsonlRecords(filePath)
        records.push(...parsed.records)
        invalidLineCount += parsed.invalidLineCount
        continue
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      records.push(...collectStructuredRecords(parsed))
    } catch {
      invalidFileCount += 1
    }
  }
  return { files, records, invalidFileCount, invalidLineCount }
}

function arrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => sanitizeDisplayText(item)).filter(Boolean)
}

function readQualityAuditReportStatus(reportPath: string, legacyReportPath: string) {
  const resolvedPath = fs.existsSync(reportPath) ? reportPath : legacyReportPath
  if (!fs.existsSync(resolvedPath)) {
    return {
      exists: false,
      path: reportPath,
      result: 'missing',
    }
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8')
    const explicitResult = content.match(/^\s*audit_result\s*:\s*(pass|needs_fix|blocked|unknown)\s*$/imu)?.[1]?.toLowerCase()
    if (explicitResult) {
      return {
        exists: true,
        path: resolvedPath,
        result: explicitResult,
      }
    }
    if (/审计结果\s*[:：]\s*通过|是否通过\s*[:：]\s*通过|结论\s*[:：]\s*通过|质量审计通过/u.test(content)) {
      return {
        exists: true,
        path: resolvedPath,
        result: 'pass',
      }
    }
    if (/不通过|未通过|高风险|建议回退|需要返工|needs_fix|blocked|假完成/u.test(content)) {
      return {
        exists: true,
        path: resolvedPath,
        result: 'needs_fix',
      }
    }
    return {
      exists: true,
      path: resolvedPath,
      result: 'unknown',
    }
  } catch {
    return {
      exists: true,
      path: resolvedPath,
      result: 'unknown',
    }
  }
}

function inferProfile(title: string, rawLength: number, blockCount: number) {
  if (/考试|医学|医师|执业|临床|口腔|病理|药|护理|诊断|治疗/u.test(title)) return 'medical_exam'
  if (/教程|编程|开发|代码|软件|模型|训练|workflow|API|工程/u.test(title)) return 'technical_tutorial'
  if (rawLength > 180_000 || blockCount > 12) return 'technical_tutorial'
  return 'lecture'
}

function readProfileFromProject(materialPath: string, profileName: string): { profile: ValidationProfile; source?: string; hash?: string } {
  const candidates = [
    path.join(materialPath, 'schemas', 'validation_profiles', `${profileName}.v8.json`),
    path.resolve(materialPath, '..', '..', '..', 'src', 'schemas', 'validation_profiles', `${profileName}.v8.json`),
    path.resolve(process.cwd(), '..', 'src', 'schemas', 'validation_profiles', `${profileName}.v8.json`),
    path.resolve(process.cwd(), 'src', 'schemas', 'validation_profiles', `${profileName}.v8.json`),
  ]
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      const raw = fs.readFileSync(candidate, 'utf-8')
      const parsed = JSON.parse(raw) as ValidationProfile
      if (parsed && parsed.profile && parsed.length_policy) {
        return {
          profile: parsed,
          source: candidate,
          hash: `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`,
        }
      }
    } catch {
      // Keep trying fallbacks.
    }
  }
  return { profile: DEFAULT_PROFILES[profileName] ?? DEFAULT_PROFILES.lecture }
}

function normalizeContract(
  materialPath: string,
  manifest: Record<string, unknown>,
  runState: Record<string, unknown>,
): ValidationContract {
  const contractPath = path.join(materialPath, CONTRACT_PATH)
  const existing = readJsonDocument(contractPath)
  const source = manifest.source && typeof manifest.source === 'object' ? manifest.source as Record<string, unknown> : {}
  const title = sanitizeDisplayText(source.title ?? (runState.material && typeof runState.material === 'object' ? (runState.material as Record<string, unknown>).title : '') ?? path.basename(materialPath), '')
  const materialId = sanitizeDisplayText(manifest.material_id ?? (runState.material && typeof runState.material === 'object' ? (runState.material as Record<string, unknown>).material_id : ''), path.basename(materialPath))
  const rawLength = Number(manifest.raw_transcript_length ?? manifest.text_length ?? 0) || 0
  const blockCount = Number(manifest.block_count ?? 0) || 0
  const inferredProfile = inferProfile(title, rawLength, blockCount)

  if (existing && typeof existing.profile === 'string' && typeof existing.mode === 'string') {
    const fallback = readProfileFromProject(materialPath, existing.profile).profile
    return {
      ...fallback,
      ...existing,
      schema_version: sanitizeDisplayText(existing.schema_version ?? 'shijie.validation-contract.v0.1'),
      contract_version: sanitizeDisplayText(existing.contract_version ?? fallback.contract_version ?? 'v8.1'),
      material_id: sanitizeDisplayText(existing.material_id ?? materialId, materialId),
      profile: sanitizeDisplayText(existing.profile, inferredProfile),
      mode: sanitizeDisplayText(existing.mode, 'standard'),
      capabilities: {
        ...fallback.capabilities,
        ...(existing.capabilities && typeof existing.capabilities === 'object' ? existing.capabilities as Record<string, 'optional' | 'required'> : {}),
      },
      required_checks: Array.isArray(existing.required_checks) ? existing.required_checks.map(String) : fallback.required_checks,
      length_policy: {
        ...fallback.length_policy,
        ...(existing.length_policy && typeof existing.length_policy === 'object' ? existing.length_policy as Partial<ValidationProfile['length_policy']> : {}),
      },
      resolved_at: sanitizeDisplayText(existing.resolved_at ?? new Date().toISOString()),
    }
  }

  const { profile, source: profileSource, hash } = readProfileFromProject(materialPath, inferredProfile)
  const contract: ValidationContract = {
    ...profile,
    schema_version: 'shijie.validation-contract.v0.1',
    contract_version: 'v8.1-legacy',
    mode: 'legacy_compatible',
    material_id: materialId,
    profile: inferredProfile,
    profile_source: profileSource ? path.relative(materialPath, profileSource).replace(/\\/gu, '/') : undefined,
    profile_hash: hash,
    resolved_at: new Date().toISOString(),
    upgrade_available: true,
    capabilities: {
      learning_page_plan: 'optional',
      candidate_source_cards: 'optional',
      required_source_cards: 'optional',
      published_claims: 'optional',
    },
    resolved_rules: {
      legacy_compatible: true,
      strict_features_required: false,
    },
  }
  writeJsonIfChanged(contractPath, contract)
  return contract
}

function countRequiredTopics(materialPath: string) {
  const coverageMatrix = readJsonDocument(path.join(materialPath, 'content_draft', 'work', 'coverage_matrix.json'))
  const topicInventory = readJsonDocument(path.join(materialPath, 'content_draft', 'work', 'topic_inventory.json'))
  const topicIds = new Set<string>()
  const collectTopics = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) collectTopics(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const topicId = sanitizeDisplayText(record.topic_id ?? '')
    const priority = sanitizeDisplayText(record.priority ?? '')
    if (topicId && (!priority || /high|medium|required|核心|高/u.test(priority))) topicIds.add(topicId)
    for (const child of Object.values(record)) collectTopics(child)
  }
  collectTopics(coverageMatrix?.topics)
  collectTopics(coverageMatrix?.branches)
  collectTopics(topicInventory?.topics)
  return topicIds.size
}

function repairIntentForIssueCodes(codes: string[]) {
  if (codes.some((code) => /trace|source_index/u.test(code))) return 'needs_trace_repair'
  if (codes.some((code) => /source_cards|evidence|published_claims/u.test(code))) return 'needs_evidence_expansion'
  if (codes.some((code) => /learning_page_plan/u.test(code))) return 'needs_page_plan_repair'
  if (codes.some((code) => /thin|short|h3|published_topics_under_supported/u.test(code))) return 'needs_deepening'
  if (codes.some((code) => /state|pipeline_ready|contract/u.test(code))) return 'needs_state_repair'
  if (codes.some((code) => /missing|invalid|placeholder|debug/u.test(code))) return 'needs_repair'
  return codes.length ? 'needs_repair' : 'none'
}

function isProductionWritten(stage: string, runState: Record<string, unknown>) {
  return stage === 'learning_notes_ready' || sanitizeDisplayText(runState.semantic_status ?? '') === 'learning_notes_written'
}

function capabilityRequired(contract: ValidationContract, capability: string) {
  return contract.capabilities?.[capability] === 'required'
}

function recordId(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = sanitizeDisplayText(record[key] ?? '')
    if (value) return value
  }
  return ''
}

function sourceEntryRefs(record: Record<string, unknown>) {
  return arrayOfStrings(record.source_index_entry_ids ?? record.source_entry_ids ?? record.entry_ids)
}

function blockRefs(record: Record<string, unknown>) {
  return arrayOfStrings(record.block_ids ?? record.blocks)
}

function sourceCardRefs(record: Record<string, unknown>) {
  return arrayOfStrings(
    record.required_source_card_ids ??
      record.source_card_ids ??
      record.source_cards ??
      record.required_cards ??
      record.card_ids,
  )
}

function hasLockedEvidenceSnapshot(record: Record<string, unknown>) {
  const excerpt = sanitizeDisplayText(record.excerpt ?? record.source_excerpt ?? record.quote ?? record.text ?? '')
  const snapshotHash = sanitizeDisplayText(record.lock_snapshot_hash ?? record.source_snapshot_hash ?? '')
  return excerpt.length >= 20 || snapshotHash.length >= 8
}

function validateSourceRefs(
  records: Record<string, unknown>[],
  sourceIndexSummary: ReturnType<typeof readSourceIndexSummary>,
) {
  const unknownEntries = new Set<string>()
  const unknownBlocks = new Set<string>()
  for (const record of records) {
    for (const entryId of sourceEntryRefs(record)) {
      if (sourceIndexSummary.entryIds.size > 0 && !sourceIndexSummary.entryIds.has(entryId)) unknownEntries.add(entryId)
    }
    for (const blockId of blockRefs(record)) {
      if (sourceIndexSummary.blockIds.size > 0 && !sourceIndexSummary.blockIds.has(blockId)) unknownBlocks.add(blockId)
    }
  }
  return { unknownEntries, unknownBlocks }
}

function checkStrictEvidenceCapabilities(
  materialPath: string,
  contract: ValidationContract,
  productionWritten: boolean,
  learningUnitCount: number,
  requiredTopicCount: number,
  sourceIndexSummary: ReturnType<typeof readSourceIndexSummary>,
  addIssue: (severity: MaterialValidationIssue['severity'], code: string, message: string, relativePath?: string) => void,
) {
  const emptyCounts = {
    learningPagePlanUnits: 0,
    candidateSourceCardCount: 0,
    requiredSourceCardCount: 0,
    publishedClaimCount: 0,
  }
  if (!productionWritten) return emptyCounts

  const learningPagePlanPath = 'content_draft/work/learning_page_plans'
  const candidateCardsPath = 'content_draft/work/source_cards/candidates'
  const requiredCardsPath = 'content_draft/work/source_cards/required'
  const publishedClaimsPath = 'content_draft/work/published_claims'

  const learningPlans = readStructuredRecordsFromDirectory(path.join(materialPath, learningPagePlanPath), ['.json', '.jsonl'])
  const candidateCards = readStructuredRecordsFromDirectory(path.join(materialPath, candidateCardsPath), ['.json', '.jsonl'])
  const requiredCards = readStructuredRecordsFromDirectory(path.join(materialPath, requiredCardsPath), ['.json', '.jsonl'])
  const publishedClaims = readStructuredRecordsFromDirectory(path.join(materialPath, publishedClaimsPath), ['.json', '.jsonl'])

  if (capabilityRequired(contract, 'learning_page_plan')) {
    if (learningPlans.files.length === 0) {
      addIssue('error', 'learning_page_plan_missing', 'strict 合同要求 learning_page_plans，但未找到 .json 或 .jsonl 计划文件。', learningPagePlanPath)
    } else if (learningPlans.invalidFileCount || learningPlans.invalidLineCount) {
      addIssue('error', 'learning_page_plan_invalid', 'learning_page_plans 存在无法解析的 JSON/JSONL。', learningPagePlanPath)
    } else if (learningPlans.records.length === 0) {
      addIssue('error', 'learning_page_plan_empty', 'learning_page_plans 没有可识别的学习页计划记录。', learningPagePlanPath)
    } else if (learningUnitCount > 0 && learningPlans.records.length < learningUnitCount) {
      addIssue(
        'error',
        'learning_page_plan_incomplete',
        `学习页计划数量 ${learningPlans.records.length} 少于最终学习单位 ${learningUnitCount}。`,
        learningPagePlanPath,
      )
    }
  }

  if (capabilityRequired(contract, 'candidate_source_cards')) {
    if (candidateCards.files.length === 0) {
      addIssue('error', 'candidate_source_cards_missing', 'strict 合同要求 candidate source cards，但候选卡目录没有 .json/.jsonl。', candidateCardsPath)
    } else if (candidateCards.invalidFileCount || candidateCards.invalidLineCount) {
      addIssue('error', 'candidate_source_cards_invalid', 'candidate source cards 存在无法解析的 JSON/JSONL。', candidateCardsPath)
    } else if (candidateCards.records.length === 0) {
      addIssue('error', 'candidate_source_cards_empty', 'candidate source cards 没有可识别记录。', candidateCardsPath)
    }
  }

  const requiredCardIds = new Set<string>()
  if (capabilityRequired(contract, 'required_source_cards')) {
    if (requiredCards.files.length === 0) {
      addIssue('error', 'required_source_cards_missing', 'strict 合同要求 required source cards，但 required 目录没有 .json/.jsonl。', requiredCardsPath)
    } else if (requiredCards.invalidFileCount || requiredCards.invalidLineCount) {
      addIssue('error', 'required_source_cards_invalid', 'required source cards 存在无法解析的 JSON/JSONL。', requiredCardsPath)
    } else if (requiredCards.records.length === 0) {
      addIssue('error', 'required_source_cards_empty', 'required source cards 没有可识别记录。', requiredCardsPath)
    }

    const cardsWithoutId = requiredCards.records.filter((record) => !recordId(record, ['card_id', 'source_card_id', 'id']))
    const cardsWithoutSource = requiredCards.records.filter((record) => sourceEntryRefs(record).length === 0 && blockRefs(record).length === 0)
    const cardsWithoutSnapshot = requiredCards.records.filter((record) => !hasLockedEvidenceSnapshot(record))
    for (const record of requiredCards.records) {
      const id = recordId(record, ['card_id', 'source_card_id', 'id'])
      if (id) requiredCardIds.add(id)
    }
    const sourceRefValidation = validateSourceRefs(requiredCards.records, sourceIndexSummary)
    if (cardsWithoutId.length > 0) addIssue('error', 'required_source_cards_missing_id', `${cardsWithoutId.length} 条 required source card 缺少 card_id/source_card_id。`, requiredCardsPath)
    if (cardsWithoutSource.length > 0) addIssue('error', 'required_source_cards_missing_source_refs', `${cardsWithoutSource.length} 条 required source card 缺少 source_index_entry_ids 或 block_ids。`, requiredCardsPath)
    if (cardsWithoutSnapshot.length > 0) addIssue('error', 'required_source_cards_missing_snapshot', `${cardsWithoutSnapshot.length} 条 required source card 缺少 excerpt 或 lock_snapshot_hash。`, requiredCardsPath)
    if (sourceRefValidation.unknownEntries.size > 0) {
      addIssue('error', 'required_source_cards_unknown_source_entries', `required source cards 指向未知 source_index_entry_ids：${Array.from(sourceRefValidation.unknownEntries).slice(0, 8).join(', ')}。`, requiredCardsPath)
    }
    if (sourceRefValidation.unknownBlocks.size > 0) {
      addIssue('error', 'required_source_cards_unknown_blocks', `required source cards 指向未知 block_ids：${Array.from(sourceRefValidation.unknownBlocks).slice(0, 8).join(', ')}。`, requiredCardsPath)
    }
  }

  if (capabilityRequired(contract, 'published_claims')) {
    if (publishedClaims.files.length === 0) {
      addIssue('error', 'published_claims_missing', 'strict 合同要求 published_claims，但未找到 .json 或 .jsonl。', publishedClaimsPath)
    } else if (publishedClaims.invalidFileCount || publishedClaims.invalidLineCount) {
      addIssue('error', 'published_claims_invalid', 'published_claims 存在无法解析的 JSON/JSONL。', publishedClaimsPath)
    } else if (publishedClaims.records.length === 0) {
      addIssue('error', 'published_claims_empty', 'published_claims 没有可识别记录。', publishedClaimsPath)
    }

    const minimumClaims = Math.max(learningUnitCount, Math.min(requiredTopicCount, learningUnitCount * 3))
    if (minimumClaims > 0 && publishedClaims.records.length < minimumClaims) {
      addIssue(
        'error',
        'published_claims_too_few',
        `published_claims 数量 ${publishedClaims.records.length} 少于当前学习单位/重点 topic 的最低审计量 ${minimumClaims}。`,
        publishedClaimsPath,
      )
    }

    const claimsWithoutText = publishedClaims.records.filter((record) => !sanitizeDisplayText(record.claim ?? record.text ?? record.statement ?? ''))
    const claimsWithoutCards = publishedClaims.records.filter((record) => sourceCardRefs(record).length === 0)
    const unknownCardRefs = new Set<string>()
    for (const record of publishedClaims.records) {
      for (const cardId of sourceCardRefs(record)) {
        if (requiredCardIds.size > 0 && !requiredCardIds.has(cardId)) unknownCardRefs.add(cardId)
      }
    }
    if (claimsWithoutText.length > 0) addIssue('error', 'published_claims_missing_text', `${claimsWithoutText.length} 条 published claim 缺少 claim/text/statement。`, publishedClaimsPath)
    if (claimsWithoutCards.length > 0) addIssue('error', 'published_claims_missing_source_cards', `${claimsWithoutCards.length} 条 published claim 缺少 required_source_card_ids/source_card_ids。`, publishedClaimsPath)
    if (unknownCardRefs.size > 0) {
      addIssue('error', 'published_claims_unknown_source_cards', `published claims 指向未知 required source cards：${Array.from(unknownCardRefs).slice(0, 8).join(', ')}。`, publishedClaimsPath)
    }
  }

  return {
    learningPagePlanUnits: learningPlans.records.length,
    candidateSourceCardCount: candidateCards.records.length,
    requiredSourceCardCount: requiredCards.records.length,
    publishedClaimCount: publishedClaims.records.length,
  }
}

export function validateMaterialPackageArtifacts(
  materialPath: string,
  manifest: Record<string, unknown>,
  runState: Record<string, unknown>,
): MaterialValidationReport {
  const issues: MaterialValidationIssue[] = []
  const addIssue = (severity: MaterialValidationIssue['severity'], code: string, message: string, relativePath?: string) => {
    issues.push({ severity, code, message, ...(relativePath ? { path: relativePath } : {}) })
  }

  const contract = normalizeContract(materialPath, manifest, runState)
  const source = manifest.source && typeof manifest.source === 'object' ? manifest.source as Record<string, unknown> : {}
  const title = sanitizeDisplayText(source.title ?? path.basename(materialPath), '')
  const materialId = sanitizeDisplayText(manifest.material_id ?? (runState.material && typeof runState.material === 'object' ? (runState.material as Record<string, unknown>).material_id : ''), path.basename(materialPath))
  const stage = sanitizeDisplayText(runState.stage ?? runState.current_stage ?? '')
  const semanticStatus = isProductionWritten(stage, runState) ? 'learning_notes_written' : sanitizeDisplayText(runState.semantic_status ?? stage, stage)
  const rawTranscriptPath = path.join(materialPath, 'raw_transcript.txt')
  const runStatePath = path.join(materialPath, 'run_state.json')
  const contentDraftDir = path.join(materialPath, 'content_draft')
  const reviewExportsDir = path.join(contentDraftDir, 'review_exports')
  const workDir = path.join(contentDraftDir, 'work')
  const learningNotesPath = path.join(contentDraftDir, 'learning_notes.md')
  const chapterMindmapPath = path.join(contentDraftDir, 'chapter_mindmap.md')
  const validationReportPath = path.join(reviewExportsDir, 'validation_report.json')
  const qualityAuditReportPath = path.join(reviewExportsDir, 'quality_audit_report.md')
  const legacyReadonlyAuditPath = path.join(reviewExportsDir, 'latest-readonly-audit.md')
  const coverageMatrixPath = path.join(workDir, 'coverage_matrix.json')
  const sourceIndexPath = path.join(materialPath, 'indexes', 'source_index.jsonl')
  const learningNotesTracePath = path.join(materialPath, 'indexes', 'learning_notes_trace.json')
  const chapterMindmapTracePath = path.join(materialPath, 'indexes', 'chapter_mindmap_trace.json')

  if (!Object.keys(manifest).length) addIssue('error', 'manifest_missing_or_invalid', 'manifest.json 缺失或不是合法 JSON。', 'manifest.json')
  if (!fs.existsSync(rawTranscriptPath)) addIssue('error', 'raw_transcript_missing', 'raw_transcript.txt 缺失。', 'raw_transcript.txt')
  if (!Object.keys(runState).length || !fs.existsSync(runStatePath)) addIssue('error', 'run_state_missing_or_invalid', 'run_state.json 缺失或不是合法 JSON。', 'run_state.json')

  const blockCount = Number(manifest.block_count ?? 0) || 0
  const rawLength = Number(manifest.raw_transcript_length ?? manifest.text_length ?? 0) || (fs.existsSync(rawTranscriptPath) ? fs.statSync(rawTranscriptPath).size : 0)
  const longMaterial = rawLength > 100_000 || blockCount > 8 || contract.profile !== 'lecture' || /考试|医学|医师|执业|基础精讲|教程|训练/u.test(title)
  const sourceIndexSummary = readSourceIndexSummary(sourceIndexPath)
  const learningNotesTraceItems = readTraceMapLinks(learningNotesTracePath)
  const chapterMindmapTraceItems = readTraceMapLinks(chapterMindmapTracePath)
  const qualityAuditStatus = readQualityAuditReportStatus(qualityAuditReportPath, legacyReadonlyAuditPath)
  const sourceIndexEntries = sourceIndexSummary.entryCount
  const learningNotesTraceLinks = learningNotesTraceItems.length
  const chapterMindmapTraceLinks = chapterMindmapTraceItems.length

  if (isProductionWritten(stage, runState)) {
    if (!fs.existsSync(sourceIndexPath)) {
      addIssue(longMaterial ? 'error' : 'warning', 'source_index_missing', 'indexes/source_index.jsonl 缺失，无法旁路追溯最终正文来源。', 'indexes/source_index.jsonl')
    } else if (sourceIndexSummary.invalidLineCount > 0) {
      addIssue('error', 'source_index_invalid_jsonl', `source_index 存在 ${sourceIndexSummary.invalidLineCount} 行无法解析。`, 'indexes/source_index.jsonl')
    } else if (blockCount > 0 && sourceIndexEntries < blockCount) {
      addIssue('warning', 'source_index_incomplete', `source_index 条目数 ${sourceIndexEntries} 少于 manifest.block_count ${blockCount}。`, 'indexes/source_index.jsonl')
    }
    if (longMaterial && !fs.existsSync(learningNotesTracePath)) {
      addIssue('error', 'learning_notes_trace_missing', '长材料缺少 indexes/learning_notes_trace.json，无法证明正文覆盖来自哪些 blocks。', 'indexes/learning_notes_trace.json')
    } else if (longMaterial && learningNotesTraceLinks === 0) {
      addIssue('error', 'learning_notes_trace_empty', 'learning_notes_trace.json 没有 trace links，正文来源仍不可审计。', 'indexes/learning_notes_trace.json')
    }
    if (longMaterial && !fs.existsSync(chapterMindmapTracePath)) {
      addIssue('error', 'chapter_mindmap_trace_missing', '长材料缺少 indexes/chapter_mindmap_trace.json，章节思维导图来源不可审计。', 'indexes/chapter_mindmap_trace.json')
    } else if (longMaterial && chapterMindmapTraceLinks === 0) {
      addIssue('error', 'chapter_mindmap_trace_empty', 'chapter_mindmap_trace.json 没有 trace links，导图来源仍不可审计。', 'indexes/chapter_mindmap_trace.json')
    }
    if (sourceIndexSummary.blockIds.size > 0) {
      for (const [traceName, tracePath, links] of [
        ['learning_notes_trace', 'indexes/learning_notes_trace.json', learningNotesTraceItems],
        ['chapter_mindmap_trace', 'indexes/chapter_mindmap_trace.json', chapterMindmapTraceItems],
      ] as const) {
        const missingBlockIds = new Set<string>()
        for (const link of links) {
          const blockIds = Array.isArray(link.block_ids) ? link.block_ids : []
          for (const blockId of blockIds) {
            const normalizedBlockId = sanitizeDisplayText(blockId)
            if (normalizedBlockId && !sourceIndexSummary.blockIds.has(normalizedBlockId)) {
              missingBlockIds.add(normalizedBlockId)
            }
          }
        }
        if (missingBlockIds.size > 0) {
          addIssue('error', `${traceName}_points_to_unknown_blocks`, `trace map 指向不存在于 source_index 的 blocks：${Array.from(missingBlockIds).slice(0, 8).join(', ')}。`, tracePath)
        }
      }
    }
    if (qualityAuditStatus.result === 'needs_fix' || qualityAuditStatus.result === 'blocked') {
      addIssue(
        'warning',
        'quality_audit_not_passed',
        `只读质量审计结果为 ${qualityAuditStatus.result}，不应视为 audit_ready。`,
        path.relative(materialPath, qualityAuditStatus.path).replace(/\\/gu, '/'),
      )
    }
  }

  let learningNotes = ''
  let learningNotesPlainLength = 0
  let h2Count = 0
  let h3Count = 0
  let shortestSectionChars = 0
  let medianSectionChars = 0
  let shortSectionCount = 0
  let shortSectionRatio = 0
  let minimumLearningNotesPlainChars = 0
  const requiredTopicCount = countRequiredTopics(materialPath)

  if (fs.existsSync(learningNotesPath)) {
    learningNotes = fs.readFileSync(learningNotesPath, 'utf-8')
    const trimmed = learningNotes.trim()
    learningNotesPlainLength = stripMarkdownForValidation(trimmed).length
    const headings = collectMarkdownHeadings(trimmed)
    const h1Count = headings.filter((heading) => heading.level === 1).length
    h2Count = headings.filter((heading) => heading.level === 2).length
    h3Count = headings.filter((heading) => heading.level === 3).length
    const h4PlusCount = headings.filter((heading) => heading.level >= 4).length
    const functionalH3Titles = headings
      .filter((heading) => heading.level === 3)
      .filter((heading) => /^(本章抓手|易混点整理|复习建议|总结|补充说明|小结|提示)$/u.test(heading.title.trim()))
      .map((heading) => heading.title)
    if (h1Count !== 1) addIssue('error', 'learning_notes_h1_invalid', `learning_notes.md 应只有 1 个一级标题，当前为 ${h1Count} 个。`, 'content_draft/learning_notes.md')
    if (isProductionWritten(stage, runState) && h2Count === 0) addIssue('error', 'learning_notes_no_chapters', 'learning_notes.md 没有二级章节。', 'content_draft/learning_notes.md')
    if (h4PlusCount > 0) addIssue('warning', 'learning_notes_too_deep', `learning_notes.md 存在 ${h4PlusCount} 个四级或更深标题，学习台可能不适合展示。`, 'content_draft/learning_notes.md')
    if (functionalH3Titles.length > 0) {
      addIssue('error', 'learning_page_functional_h3_titles', `H3 应是可打开学习页，不应使用功能标题：${Array.from(new Set(functionalH3Titles)).join('、')}。`, 'content_draft/learning_notes.md')
    }

    const h3Lengths = collectHeadingBodyLengths(trimmed, 3).map((section) => section.chars).filter((chars) => chars > 0)
    shortestSectionChars = h3Lengths.length ? Math.min(...h3Lengths) : 0
    medianSectionChars = median(h3Lengths)
    shortSectionCount = h3Lengths.filter((chars) => chars < contract.length_policy.short_h3_threshold).length
    shortSectionRatio = h3Lengths.length ? Number((shortSectionCount / h3Lengths.length).toFixed(3)) : 0

    if (/source_refs?|block_\d{3,}|raw offset|raw_offset|debug|字幕证据|制作过程/iu.test(trimmed)) {
      addIssue('error', 'learning_notes_has_debug_refs', 'learning_notes.md 含有 source_ref、block_id 或后台制作词，学生正文不干净。', 'content_draft/learning_notes.md')
    }
    if (/TODO|待补充|此处省略|placeholder|TBD/iu.test(trimmed)) {
      addIssue('error', 'learning_notes_has_placeholder', 'learning_notes.md 含有 TODO、待补充或占位符。', 'content_draft/learning_notes.md')
    }

    if (longMaterial) {
      minimumLearningNotesPlainChars = Math.round(Math.max(
        contract.length_policy.absolute_floor,
        rawLength * contract.length_policy.raw_ratio_floor,
        h3Count * contract.length_policy.min_chars_per_h3,
        requiredTopicCount * contract.length_policy.min_chars_per_required_topic,
      ))
      if (learningNotesPlainLength < minimumLearningNotesPlainChars) {
        addIssue(
          'error',
          'learning_notes_too_thin_for_long_material',
          `长材料正文偏薄：正文约 ${learningNotesPlainLength} 字符，当前 ${contract.profile} 合同建议至少达到约 ${minimumLearningNotesPlainChars} 字符。`,
          'content_draft/learning_notes.md',
        )
      }
      if (h3Count >= 8 && medianSectionChars > 0 && medianSectionChars < contract.length_policy.h3_median_floor) {
        addIssue(
          'error',
          'learning_units_too_short',
          `可打开小节偏短：${h3Count} 个三级小节的中位长度约 ${medianSectionChars} 字符，低于 ${contract.profile} 合同下限 ${contract.length_policy.h3_median_floor}。`,
          'content_draft/learning_notes.md',
        )
      }
      if (h3Count >= 8 && shortSectionRatio > contract.length_policy.short_h3_ratio_limit) {
        addIssue(
          'error',
          'learning_units_short_ratio_too_high',
          `短 H3 比例过高：${shortSectionCount}/${h3Count} 低于 ${contract.length_policy.short_h3_threshold} 字符，比例 ${shortSectionRatio} 高于合同上限 ${contract.length_policy.short_h3_ratio_limit}。`,
          'content_draft/learning_notes.md',
        )
      }
    }
  } else if (isProductionWritten(stage, runState)) {
    addIssue('error', 'learning_notes_missing', 'run_state 已标记学习笔记写完，但 learning_notes.md 缺失。', 'content_draft/learning_notes.md')
  }

  if (fs.existsSync(chapterMindmapPath)) {
    const mindmap = fs.readFileSync(chapterMindmapPath, 'utf-8').trim()
    if (mindmap.length < 240) addIssue('error', 'chapter_mindmap_too_short', 'chapter_mindmap.md 过短，不像有效章节思维导图。', 'content_draft/chapter_mindmap.md')
    if (/source_refs?|block_\d{3,}|raw offset|raw_offset|debug|字幕证据|制作过程/iu.test(mindmap)) {
      addIssue('error', 'chapter_mindmap_has_debug_refs', 'chapter_mindmap.md 含有 source_ref、block_id 或后台制作词。', 'content_draft/chapter_mindmap.md')
    }
    if (/TODO|待补充|此处省略|placeholder|TBD/iu.test(mindmap)) {
      addIssue('error', 'chapter_mindmap_has_placeholder', 'chapter_mindmap.md 含有 TODO、待补充或占位符。', 'content_draft/chapter_mindmap.md')
    }
  } else if (isProductionWritten(stage, runState)) {
    addIssue('error', 'chapter_mindmap_missing', 'run_state 已标记学习笔记写完，但 chapter_mindmap.md 缺失。', 'content_draft/chapter_mindmap.md')
  }

  for (const [relativePath, code, message] of [
    ['content_draft/work/knowledge_tree.json', 'knowledge_tree_missing', 'knowledge_tree.json 缺失。'],
    ['content_draft/work/coverage_matrix.json', 'coverage_matrix_missing', 'coverage_matrix.json 缺失。'],
    ['content_draft/work/block_reread_ledger.jsonl', 'block_reread_ledger_missing', 'block_reread_ledger.jsonl 缺失。'],
    ['content_draft/work/self_check.md', 'self_check_missing', 'self_check.md 缺失。'],
  ] as const) {
    if (isProductionWritten(stage, runState) && !fs.existsSync(path.join(materialPath, relativePath))) {
      addIssue('error', code, message, relativePath)
    }
  }

  const learningUnitCount = h3Count > 0 ? h3Count : h2Count
  const strictEvidenceSummary = checkStrictEvidenceCapabilities(
    materialPath,
    contract,
    isProductionWritten(stage, runState),
    learningUnitCount,
    requiredTopicCount,
    sourceIndexSummary,
    addIssue,
  )

  const coverageMatrix = readJsonDocument(coverageMatrixPath)
  if (coverageMatrix && longMaterial) {
    const branches = Array.isArray(coverageMatrix.branches) ? coverageMatrix.branches as Array<Record<string, unknown>> : []
    const examReviewBranch = branches.find((branch) => /考试|复盘|题干|易混/u.test(sanitizeDisplayText(branch.title ?? '')))
    if (examReviewBranch) {
      const draftStatus = sanitizeDisplayText(examReviewBranch.draft_status ?? '')
      const coverageStatus = sanitizeDisplayText(examReviewBranch.coverage_status ?? '')
      if (!/published/i.test(draftStatus) && !/published/i.test(coverageStatus)) {
        addIssue(
          'error',
          'exam_review_branch_not_published',
          '考试/复盘分支没有进入 learning_notes.md。对医学考试材料，这通常意味着复习价值被压缩到导图或索引层。',
          'content_draft/work/coverage_matrix.json',
        )
      }
    }
  }

  const errorIssues = issues.filter((issue) => issue.severity === 'error')
  const errorCount = errorIssues.length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const finalArtifactsExist = fs.existsSync(learningNotesPath) && fs.existsSync(chapterMindmapPath)
  const contractAllowsPipelineReady = contract.mode !== 'legacy_compatible'
  const productionWritten = isProductionWritten(stage, runState)
  const strictReady = productionWritten && finalArtifactsExist && errorCount === 0 && contractAllowsPipelineReady
  const legacyValidationPassed = productionWritten && finalArtifactsExist && errorCount === 0 && !contractAllowsPipelineReady
  const pipelineReady = strictReady
  const auditReady = pipelineReady && (runState.audit_ready === true || qualityAuditStatus.result === 'pass')
  const releaseReady = auditReady && runState.release_ready === true
  const repairIntent = repairIntentForIssueCodes(errorIssues.map((issue) => issue.code))
  const blockingReasons = errorIssues.map((issue) => ({
    code: issue.code,
    severity: 'blocking' as const,
    message: issue.message,
    repair_intent: repairIntentForIssueCodes([issue.code]),
    ...(issue.path ? { path: issue.path } : {}),
  }))
  const validationStatus: MaterialValidationReport['validation_status'] = pipelineReady || legacyValidationPassed
    ? 'passed'
    : productionWritten
      ? 'failed'
      : 'not_ready'
  const summary = {
    error_count: errorCount,
    warning_count: warningCount,
    learning_notes_chars: learningNotes.length,
    learning_notes_plain_chars: learningNotesPlainLength,
    chapter_count: h2Count,
    section_count: h3Count,
    shortest_section_chars: shortestSectionChars,
    median_section_chars: medianSectionChars,
    short_section_count: shortSectionCount,
    short_section_ratio: shortSectionRatio,
    minimum_learning_notes_plain_chars: minimumLearningNotesPlainChars,
    required_topic_count: requiredTopicCount,
    long_material: longMaterial,
    source_index_entries: sourceIndexEntries,
    learning_notes_trace_links: learningNotesTraceLinks,
    chapter_mindmap_trace_links: chapterMindmapTraceLinks,
    learning_page_plan_units: strictEvidenceSummary.learningPagePlanUnits,
    candidate_source_card_count: strictEvidenceSummary.candidateSourceCardCount,
    required_source_card_count: strictEvidenceSummary.requiredSourceCardCount,
    published_claim_count: strictEvidenceSummary.publishedClaimCount,
    quality_audit_report_exists: qualityAuditStatus.exists,
    quality_audit_result: qualityAuditStatus.result,
  }
  const comparableReportPayload = {
    stage,
    semantic_status: semanticStatus,
    validation_status: validationStatus,
    contract_version: contract.contract_version,
    contract_mode: contract.mode,
    profile: contract.profile,
    pipeline_ready: pipelineReady,
    legacy_validation_passed: legacyValidationPassed,
    audit_ready: auditReady,
    release_ready: releaseReady,
    repair_intent: repairIntent,
    blocking_reasons: blockingReasons,
    summary,
    issues,
  }
  const previousReport = readJsonDocument(validationReportPath)
  const previousComparablePayload = previousReport
    ? {
        stage: previousReport.stage,
        semantic_status: previousReport.semantic_status,
        validation_status: previousReport.validation_status,
        contract_version: previousReport.contract_version,
        contract_mode: previousReport.contract_mode,
        profile: previousReport.profile,
        pipeline_ready: previousReport.pipeline_ready,
        legacy_validation_passed: previousReport.legacy_validation_passed,
        audit_ready: previousReport.audit_ready,
        release_ready: previousReport.release_ready,
        repair_intent: previousReport.repair_intent,
        blocking_reasons: previousReport.blocking_reasons,
        summary: previousReport.summary,
        issues: previousReport.issues,
      }
    : null
  const generatedAt = previousReport &&
    typeof previousReport.generated_at === 'string' &&
    JSON.stringify(previousComparablePayload) === JSON.stringify(comparableReportPayload)
    ? previousReport.generated_at
    : new Date().toISOString()

  const report: MaterialValidationReport = {
    schema_version: 'shijie.material-validation.v0.2',
    generated_at: generatedAt,
    material_id: materialId,
    material_path: materialPath,
    stage,
    semantic_status: semanticStatus,
    validation_status: validationStatus,
    contract_version: contract.contract_version,
    contract_mode: contract.mode,
    profile: contract.profile,
    pipeline_ready: pipelineReady,
    legacy_validation_passed: legacyValidationPassed,
    upgrade_required_for_pipeline_ready: legacyValidationPassed || contract.mode === 'legacy_compatible',
    audit_ready: auditReady,
    release_ready: releaseReady,
    repair_intent: repairIntent,
    blocking_reasons: blockingReasons,
    summary,
    issues,
  }

  writeJsonIfChanged(validationReportPath, report)

  if (fs.existsSync(runStatePath)) {
    const nextRunState = {
      ...runState,
      semantic_status: semanticStatus,
      pipeline_ready: pipelineReady,
      legacy_validation_passed: legacyValidationPassed,
      upgrade_required_for_pipeline_ready: report.upgrade_required_for_pipeline_ready,
      audit_ready: auditReady,
      release_ready: releaseReady,
      repair_intent: repairIntent,
      needs_deepening: repairIntent === 'needs_deepening',
      blocking_reason_codes: blockingReasons.map((reason) => reason.code),
      validation_contract: CONTRACT_PATH,
      last_validation_report: VALIDATION_REPORT_PATH,
      validation_report: VALIDATION_REPORT_PATH,
      importable: pipelineReady,
    }
    writeJsonIfChanged(runStatePath, nextRunState)
  }

  return report
}

export function validateMaterialPackageAtPath(materialPath: string) {
  const manifest = readJsonDocument(path.join(materialPath, 'manifest.json')) ?? {}
  const runState = readJsonDocument(path.join(materialPath, 'run_state.json')) ?? {}
  return validateMaterialPackageArtifacts(materialPath, manifest, runState)
}
