import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { MaterialPackageSummary } from './materialInventory'

type PersistedNodeLearningSession = {
  nodeId: string
  learningStatus: 'teaching' | 'quizzing' | 'completed'
  messages: Array<{
    id: string
    role: 'system' | 'coach' | 'user'
    content: string
    nodeId?: string
    createdAt: number
  }>
  activeQuestion: string | null
  lastUserAnswer: string
  lastEvaluation: 'correct' | 'partial' | 'incorrect' | null
  hydrated: boolean
  preloaded: boolean
  updatedAt: number
}

export type LearningArchiveRecord = {
  id: string
  packageId: string
  title: string
  sourceTitle: string
  sourceId: string
  sourceUrl?: string
  importedCoursePath: string | null
  packagePath: string | null
  courseText: string
  currentNodeId: string | null
  completedNodeIds: string[]
  nodeSessions: Record<string, PersistedNodeLearningSession>
  milestoneEvents: Array<{
    id: string
    kind: 'node_complete' | 'stage_complete' | 'course_complete'
    title: string
    detail: string
    createdAt: number
    nodeId?: string | null
    stageId?: string | null
    progressPercent?: number
  }>
  progressPercent: number
  isArchived: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

export function isMaterialRecordSummaryReady(record: MaterialPackageSummary | null): record is MaterialPackageSummary {
  return Boolean(record?.editorialSummaryExists || record?.editorialSummaryHtmlExists)
}

export function isMaterialRecordCleaned(record: MaterialPackageSummary | null) {
  return Boolean(record && (record.notebooklmExists || record.rawTranscriptExists))
}

function createLearningArchiveId(record: MaterialPackageSummary) {
  const identity = `${record.sourceId || ''}\n${path.resolve(record.path)}`
  return `archive-${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 12)}`
}

function stripMarkdownForSummary(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .replace(/[#>*_`~|:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildArchivedLearningRecordFromMaterialRecord(record: MaterialPackageSummary): LearningArchiveRecord {
  const articlePath = record.editorialSummaryExists && fs.existsSync(record.editorialSummaryPath)
    ? record.editorialSummaryPath
    : ''
  if (!articlePath) {
    throw new Error(`精读稿不存在：${record.title}`)
  }

  const content = fs.readFileSync(articlePath, 'utf-8').trim()
  if (!content) {
    throw new Error(`精读稿为空：${record.title}`)
  }

  const htmlContent = record.editorialSummaryHtmlExists && fs.existsSync(record.editorialSummaryHtmlPath)
    ? fs.readFileSync(record.editorialSummaryHtmlPath, 'utf-8').trim()
    : ''
  const archiveId = createLearningArchiveId(record)
  const packageId = `study-package-${archiveId}`
  const nodeId = `article-${archiveId.replace(/^archive-/u, '')}`
  const now = Date.now()
  const summary = stripMarkdownForSummary(content).slice(0, 240) || record.title
  const courseText = JSON.stringify(
    {
      schema_version: 'shijie.study-package.v0.1',
      package_id: packageId,
      source: {
        source_type: 'video_article',
        source_id: record.sourceId || packageId,
        title: record.title,
        creator: record.creator,
        url: record.sourceUrl,
        language: 'zh-CN',
        ingested_at: new Date(now).toISOString(),
        text_length: content.length,
        notes: `由任务队列自动归档。资料包：${record.path}`,
      },
      course: {
        title: record.title,
        subtitle: '视频精读稿',
        overall_goal: '阅读这篇视频精读稿，理解视频的主要信息、判断和线索。',
        target_audience: '希望快速读懂这条视频内容的读者。',
        prerequisites: [],
        learning_outcomes: [
          '能复述视频的主线信息。',
          '能说清文稿中的关键判断。',
          '能把重要事实、例子和结论联系起来。',
        ],
        completion_definition: '读完全文并能说清主要内容。',
        estimated_total_minutes: Math.max(5, Math.ceil(content.length / 650)),
      },
      chapters: [
        {
          id: nodeId,
          node_type: 'lesson',
          title: record.title,
          summary,
          order: 1,
          learning_objectives: ['读懂这篇视频精读稿。', '理解视频中的关键信息和判断。'],
          teacher_ready_content: {
            lesson_profile: 'concept',
            display_hints: ['video_article', 'article_reading'],
            primary_training_action: '阅读',
            training_focus: [],
            teaching_markdown: content,
            teaching_html: htmlContent,
            quiz_question: '',
            standard_answer: summary,
            key_points: [],
            common_mistakes: [],
          },
          source_refs: [
            {
              kind: 'material_package',
              label: '本地资料包',
            },
          ],
          dependencies: [],
          knowledge: {
            concepts: [],
            examples: [],
            checkpoints: [],
            common_mistakes: [],
          },
          children: [],
          assets: [],
          gaps: [],
        },
      ],
      dependency_graph: [],
      assets: [],
      gaps: [],
    },
    null,
    2,
  )

  return {
    id: archiveId,
    packageId,
    title: record.title,
    sourceTitle: record.title,
    sourceId: record.sourceId,
    sourceUrl: record.sourceUrl,
    importedCoursePath: null,
    packagePath: null,
    courseText,
    currentNodeId: nodeId,
    completedNodeIds: [nodeId],
    nodeSessions: {
      [nodeId]: {
        nodeId,
        learningStatus: 'completed',
        messages: [],
        activeQuestion: null,
        lastUserAnswer: '',
        lastEvaluation: null,
        hydrated: true,
        preloaded: true,
        updatedAt: now,
      },
    },
    milestoneEvents: [
      {
        id: `milestone-${archiveId}`,
        kind: 'course_complete',
        title: '资料归档',
        detail: '视频精读稿已自动收录到档案。',
        createdAt: now,
        nodeId,
        progressPercent: 100,
      },
    ],
    progressPercent: 100,
    isArchived: true,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
}
