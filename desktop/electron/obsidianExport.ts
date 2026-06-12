import { shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { sanitizeDisplayText, type RuntimeSettings } from './settings'
import { compactStudyPackagePayload } from './studyPackageCompat'

const APP_PROTOCOL = 'shijiefocus'

export type ObsidianExportPayload = {
  course: Record<string, unknown>
  currentNodeId: string | null
  completedNodeIds: string[]
}

export type ObsidianExportResult = {
  vaultPath: string
  rootDir: string
  indexPath: string
  progressPath: string
  currentNodePath: string | null
  fileCount: number
}

export type ObsidianOpenResult = ObsidianExportResult & {
  openedPath: string
  openedUri: string | null
  openedVia: 'obsidian-uri' | 'file-path'
}

export function sanitizeFileNameSegment(value: string, fallback = '未命名') {
  const normalized = String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function sanitizeWikiSegment(value: string, fallback = '未命名') {
  const normalized = String(value ?? '')
    .replace(/[\[\]\|#^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function stripStagePrefix(title: string) {
  return title
    .replace(/^(?:学习)?阶段\s*\d+\s*[·\-:：]\s*/u, '')
    .replace(/^阶段\s*\d+\s*/u, '')
    .trim()
}

function stripObsidianTitleNoise(title: string) {
  return title
    .replace(/^[0０]*\d{1,3}\s*[._\-、:：]+\s*/u, '')
    .replace(/^[0０]*\d{1,3}\s+/u, '')
    .replace(/^第\s*[一二三四五六七八九十百千万\d]+\s*(?:站|章|节|课|讲)\s*[·\-:：]?\s*/u, '')
    .replace(/^[（(]?[一二三四五六七八九十百千万\d]+[）)]?[、.．]\s*/u, '')
    .replace(/\s*[（(]\s*\d+\s*分\s*[）)]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildObsidianNodeTitle(rawTitle: string, parentTitle: string | null) {
  const cleanedRawTitle = sanitizeDisplayText(rawTitle, '未命名节点')
  const normalizedTitle = stripObsidianTitleNoise(stripStagePrefix(cleanedRawTitle) || cleanedRawTitle) || cleanedRawTitle
  const normalizedParent = parentTitle
    ? stripObsidianTitleNoise(stripStagePrefix(sanitizeDisplayText(parentTitle, '未命名主线')))
    : null

  const genericLeafTitles = new Set([
    '定义',
    '概念',
    '示例',
    '例子',
    '流程',
    '方法',
    '用法',
    '作用',
    '总结',
    '特点',
    '检查',
    '判断',
    '操作',
  ])

  if (normalizedParent && (genericLeafTitles.has(normalizedTitle) || normalizedTitle.length <= 3)) {
    return `${normalizedParent} · ${normalizedTitle}`
  }

  return normalizedTitle
}

function escapeYamlString(value: string) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function renderYamlList(items: string[], indent = 0) {
  const prefix = ' '.repeat(indent)
  if (!items.length) return `${prefix}[]`
  return items.map((item) => `${prefix}- ${escapeYamlString(item)}`).join('\n')
}

function renderBulletList(items: string[]) {
  if (!items.length) return '- 暂无'
  return items.map((item) => `- ${item}`).join('\n')
}

function renderWikiList(items: Array<{ target: string; label: string }>) {
  if (!items.length) return '- 暂无'
  return items.map((item) => `- [[${item.target}|${item.label}]]`).join('\n')
}


function normalizeMarkdownNewlines(value: string) {
  return value.replace(/\r\n/g, '\n')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractMarkdownSection(markdown: string, heading: string) {
  const normalized = normalizeMarkdownNewlines(markdown)
  const pattern = new RegExp(`(^## ${escapeRegExp(heading)}\\n)([\\s\\S]*?)(?=^## |\\Z)`, 'm')
  const match = normalized.match(pattern)
  if (!match) return ''
  return match[2].replace(/^\n+/, '').replace(/\n+$/, '').trim()
}

function renderMarkdownSection(title: string, fallbackContent: string, existingMarkdown = '') {
  const preserved = existingMarkdown ? extractMarkdownSection(existingMarkdown, title) : ''
  const content = preserved || fallbackContent
  return [`## ${title}`, '', content, '']
}

function indentCalloutBody(content: string) {
  const normalized = normalizeMarkdownNewlines(content).trim()
  if (!normalized) return '> 暂无'
  return normalized.split('\n').map((line) => `> ${line}`).join('\n')
}

function renderObsidianCallout(type: string, title: string, content: string, options: { folded?: boolean } = {}) {
  const marker = options.folded ? `[!${type}]-` : `[!${type}]`
  return [`> ${marker} ${title}`, indentCalloutBody(content)].join('\n')
}

function renderObsidianCalloutList(type: string, title: string, items: string[]) {
  return renderObsidianCallout(type, title, items.length ? renderBulletList(items) : '- 暂无')
}

function normalizeCalloutHeading(value: string) {
  return value
    .replace(/^[\p{Extended_Pictographic}\u2600-\u27BF]\s*/u, '')
    .replace(/[：:]\s*$/, '')
    .trim()
}

function resolveTeachingSectionCallout(heading: string): { type: string; folded?: boolean } | null {
  const normalized = normalizeCalloutHeading(heading)
  if (/这一关要学会什么|学习目标|目标|要学会什么/u.test(normalized)) return { type: 'abstract' }
  if (/核心概念|基础概念|概念|定义|是什么/u.test(normalized)) return { type: 'abstract' }
  if (/前置条件|准备|依赖|环境|基础要求/u.test(normalized)) return { type: 'info' }
  if (/配置步骤|标准操作步骤|操作步骤|步骤|流程|怎么做|如何做/u.test(normalized)) return { type: 'todo' }
  if (/验证|排错|检查|自查|评分点|验收/u.test(normalized)) return { type: 'example' }
  if (/为什么|原理|机制|逻辑|重要性|每一步为什么重要/u.test(normalized)) return { type: 'info' }
  if (/例子|示例|案例|场景|演示/u.test(normalized)) return { type: 'example' }
  if (/注意|错误|误区|陷阱|红线|风险/u.test(normalized)) return { type: 'warning' }
  if (/一句话记忆|记忆|口诀|总结/u.test(normalized)) return { type: 'quote' }
  return null
}

function enhanceTeachingMarkdownForObsidian(markdown: string) {
  const normalized = normalizeMarkdownNewlines(markdown).trim()
  if (!normalized) return ''

  const lines = normalized.split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const headingMatch = lines[index].match(/^(#{2,4})\s+(.+?)\s*$/)
    if (!headingMatch) {
      output.push(lines[index])
      index += 1
      continue
    }

    const level = headingMatch[1].length
    const heading = headingMatch[2].trim()
    const callout = resolveTeachingSectionCallout(heading)
    if (!callout) {
      output.push(lines[index])
      index += 1
      continue
    }

    index += 1
    const sectionLines: string[] = []
    while (index < lines.length) {
      const nextHeading = lines[index].match(/^(#{2,4})\s+(.+?)\s*$/)
      if (nextHeading && nextHeading[1].length <= level) break
      sectionLines.push(lines[index])
      index += 1
    }

    const sectionBody = sectionLines.join('\n').trim()
    if (!sectionBody) {
      output.push(`${headingMatch[1]} ${heading}`)
      continue
    }

    output.push('', renderObsidianCallout(callout.type, normalizeCalloutHeading(heading), sectionBody, { folded: callout.folded }), '')
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function ensureObsidianCourseSnippet(vaultPath: string) {
  const snippetsDir = path.join(vaultPath, '.obsidian', 'snippets')
  fs.mkdirSync(snippetsDir, { recursive: true })
  const snippetPath = path.join(snippetsDir, 'shijie-focus-course.css')
  const css = [
    '/* 视界专注资料档案：启用位置 Obsidian 设置 -> 外观 -> CSS snippets -> shijie-focus-course */',
    '.markdown-preview-view.shijie-course-note,',
    '.markdown-preview-view.shijie-course-home,',
    '.markdown-preview-view.shijie-course-board,',
    '.markdown-reading-view .markdown-preview-view.shijie-course-note,',
    '.markdown-reading-view .markdown-preview-view.shijie-course-home,',
    '.markdown-reading-view .markdown-preview-view.shijie-course-board {',
    '  --shijie-accent: 125, 211, 252;',
    '  --shijie-soft-border: rgba(255, 255, 255, 0.10);',
    '}',
    '',
    '.callout[data-callout="goal"] {',
    '  --callout-color: 125, 211, 252;',
    '  --callout-icon: lucide-crosshair;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note .callout,',
    '.markdown-preview-view.shijie-course-home .callout,',
    '.markdown-preview-view.shijie-course-board .callout {',
    '  border-radius: 14px;',
    '  border: 1px solid var(--shijie-soft-border);',
    '  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.10);',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note .callout-title,',
    '.markdown-preview-view.shijie-course-home .callout-title,',
    '.markdown-preview-view.shijie-course-board .callout-title {',
    '  font-weight: 700;',
    '  letter-spacing: 0.01em;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note h1,',
    '.markdown-preview-view.shijie-course-home h1,',
    '.markdown-preview-view.shijie-course-board h1 {',
    '  letter-spacing: 0;',
    '  border-bottom: 1px solid rgba(255, 255, 255, 0.08);',
    '  padding-bottom: 0.35em;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note h2,',
    '.markdown-preview-view.shijie-course-home h2,',
    '.markdown-preview-view.shijie-course-board h2 {',
    '  margin-top: 1.35em;',
    '  letter-spacing: 0;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note p,',
    '.markdown-preview-view.shijie-course-note li {',
    '  line-height: 1.85;',
    '}',
    '',
  ].join('\n')
  fs.writeFileSync(snippetPath, css, 'utf-8')
  return snippetPath
}

function buildAppDeepLink(packageId: string, nodeId?: string | null) {
  const params = new URLSearchParams()
  params.set('packageId', packageId)
  if (nodeId) params.set('nodeId', nodeId)
  return `${APP_PROTOCOL}://open?${params.toString()}`
}

function flattenCourseNodes(nodes: Record<string, unknown>[], parentId: string | null = null, depth = 0) {
  const result: Array<{
    node: Record<string, unknown>
    parentId: string | null
    depth: number
  }> = []

  for (const node of nodes) {
    result.push({ node, parentId, depth })
    const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
    result.push(...flattenCourseNodes(children, String(node.id ?? ''), depth + 1))
  }

  return result
}

type ObsidianReadableLessonMeta = {
  id: string
  title: string
  noteTitle: string
  wikiTarget: string
  filePath: string
  parentId: string | null
  rootTitle: string
  node: Record<string, unknown>
}

export function exportCourseToObsidian(settings: RuntimeSettings, payload: ObsidianExportPayload): ObsidianExportResult {
  const vaultPath = settings.obsidian_vault_path
  if (!vaultPath) {
    throw new Error('请先在设置中配置 Obsidian Vault 路径。')
  }
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error('Obsidian Vault 路径不存在，或不是文件夹。')
  }

  const asText = (value: unknown, fallback = '') => sanitizeDisplayText(String(value ?? ''), fallback)
  const asStringList = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => sanitizeDisplayText(String(item ?? ''))).filter(Boolean)
      : []
  const asRecordList = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      : []
  const getRecord = (value: unknown) => (value && typeof value === 'object' ? value as Record<string, unknown> : {})
  const renderOptionalBullets = (items: string[]) => (items.length ? renderBulletList(items) : '- 暂无')
  const uniqueStrings = (items: string[]) => Array.from(new Set(items.filter(Boolean)))
  const normalizeLessonMarkdown = (markdown: string) => markdown.replace(/^##\s+/gm, '### ')
  const renderReadableAnswer = (markdown: string) => {
    const normalized = normalizeMarkdownNewlines(markdown).trim()
    if (!normalized) return '- 暂无参考回看'
    return normalized
      .split(/(?<=[。！？；;])/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .join('\n\n')
  }
  const getTeacher = (node: Record<string, unknown>) => getRecord(node.teacher_ready_content)
  const getKnowledge = (node: Record<string, unknown>) => getRecord(node.knowledge)

  const course = compactStudyPackagePayload((payload.course ?? {}) as Record<string, unknown>).payload
  const courseMeta = getRecord(course.course)
  const sourceMeta = getRecord(course.source)
  const chapters = asRecordList(course.chapters)
  const packageId = String(course.package_id ?? 'unknown-package')
  const courseTitle = asText(courseMeta.title ?? sourceMeta.title ?? packageId, '未命名学习笔记')
  const exportedAt = new Date().toISOString()
  const exportFolder = sanitizeFileNameSegment(settings.obsidian_export_folder || '视界专注', '视界专注')
  const courseFolder = sanitizeFileNameSegment(courseTitle, packageId)
  const exportWikiFolder = sanitizeWikiSegment(exportFolder, '视界专注')
  const courseWikiFolder = sanitizeWikiSegment(courseFolder, packageId)
  const courseWikiRoot = `${exportWikiFolder}/${courseWikiFolder}`
  const overviewNoteTitle = '学习总览'
  const progressNoteTitle = '学习看板'
  const conceptNoteTitle = '关键概念'
  const mistakeNoteTitle = '常见误区'
  const practiceNoteTitle = '练习与操作'
  const overviewWikiTarget = `${courseWikiRoot}/${overviewNoteTitle}`
  const progressWikiTarget = `${courseWikiRoot}/${progressNoteTitle}`
  const rootDir = path.join(vaultPath, exportFolder, courseFolder)
  const lessonFolderName = '学习笔记'
  const lessonDir = path.join(rootDir, lessonFolderName)
  const snippetPath = ensureObsidianCourseSnippet(vaultPath)
  void snippetPath

  fs.mkdirSync(rootDir, { recursive: true })
  for (const oldFolderName of ['节点', 'Lessons', 'Concepts', 'Mistakes', 'Practices']) {
    fs.rmSync(path.join(rootDir, oldFolderName), { recursive: true, force: true })
  }
  fs.mkdirSync(lessonDir, { recursive: true })

  const flattened = flattenCourseNodes(chapters)
  const parentById = new Map<string, string | null>()
  const rawTitleById = new Map<string, string>()
  flattened.forEach(({ node, parentId }, index) => {
    const nodeId = String(node.id ?? `node-${index + 1}`)
    parentById.set(nodeId, parentId)
    rawTitleById.set(nodeId, asText(node.title ?? nodeId, nodeId))
  })

  const getRootTitle = (nodeId: string) => {
    let cursor: string | null = nodeId
    let rootTitle = rawTitleById.get(nodeId) ?? nodeId
    while (cursor) {
      rootTitle = rawTitleById.get(cursor) ?? rootTitle
      cursor = parentById.get(cursor) ?? null
    }
    return rootTitle
  }

  const leafLessons = flattened.filter(({ node }) => {
    const children = asRecordList(node.children)
    return String(node.node_type ?? '').toLowerCase() === 'lesson' || children.length === 0
  })
  const exportedLessons = leafLessons.length ? leafLessons : flattened
  const usedLessonTitles = new Map<string, number>()
  const lessonMetaById = new Map<string, ObsidianReadableLessonMeta>()
  const lessonOrder: string[] = []

  exportedLessons.forEach(({ node, parentId }, index) => {
    const nodeId = String(node.id ?? `lesson-${index + 1}`)
    const parentTitle = parentId ? rawTitleById.get(parentId) ?? null : null
    const displayTitle = buildObsidianNodeTitle(String(node.title ?? nodeId), parentTitle)
    const baseTitle = sanitizeWikiSegment(displayTitle, nodeId)
    const duplicateCount = (usedLessonTitles.get(baseTitle) ?? 0) + 1
    usedLessonTitles.set(baseTitle, duplicateCount)
    const stableTitle = duplicateCount > 1 ? `${baseTitle}（${duplicateCount}）` : baseTitle
    const noteTitle = `${String(index + 1).padStart(2, '0')} ${stableTitle}`
    const filePath = path.join(lessonDir, `${sanitizeFileNameSegment(noteTitle, nodeId)}.md`)
    lessonOrder.push(nodeId)
    lessonMetaById.set(nodeId, {
      id: nodeId,
      title: stableTitle,
      noteTitle,
      wikiTarget: `${courseWikiRoot}/${lessonFolderName}/${noteTitle}`,
      filePath,
      parentId,
      rootTitle: getRootTitle(nodeId),
      node,
    })
  })

  const conceptEntries: Array<{ lesson: ObsidianReadableLessonMeta; title: string; content: string }> = []
  const mistakeEntries: Array<{ lesson: ObsidianReadableLessonMeta; content: string }> = []
  const practiceEntries: Array<{ lesson: ObsidianReadableLessonMeta; title: string; items: string[] }> = []

  for (const [nodeId, meta] of lessonMetaById.entries()) {
    const node = meta.node
    const teacher = getTeacher(node)
    const knowledge = getKnowledge(node)
    const objectives = asStringList(node.learning_objectives)
    const concepts = asRecordList(knowledge.concepts)
    const checkpoints = asStringList(knowledge.checkpoints)
    const practicalSteps = asStringList(knowledge.practical_steps)
    const practiceTasks = asStringList(knowledge.practice_tasks)
    const teacherKeyPoints = asStringList(teacher.key_points)
    const knowledgeMistakes = asStringList(knowledge.common_mistakes)
    const teacherMistakes = asStringList(teacher.common_mistakes)
    const allMistakes = uniqueStrings([...teacherMistakes, ...knowledgeMistakes])
    const teachingMarkdown = normalizeMarkdownNewlines(String(teacher.teaching_markdown ?? '')).trim()
    const quizQuestion = asText(teacher.quiz_question, '')
    const standardAnswer = normalizeMarkdownNewlines(String(teacher.standard_answer ?? '')).trim()
    const progressState =
      payload.currentNodeId === nodeId
        ? 'current'
        : payload.completedNodeIds.includes(nodeId)
          ? 'completed'
          : 'pending'
    const currentIndex = lessonOrder.indexOf(nodeId)
    const previousMeta = currentIndex > 0 ? lessonMetaById.get(lessonOrder[currentIndex - 1]) ?? null : null
    const nextMeta = currentIndex >= 0 && currentIndex < lessonOrder.length - 1 ? lessonMetaById.get(lessonOrder[currentIndex + 1]) ?? null : null
    const existingMarkdown = fs.existsSync(meta.filePath) ? fs.readFileSync(meta.filePath, 'utf-8') : ''
    const lessonBody = enhanceTeachingMarkdownForObsidian(
      normalizeLessonMarkdown(teachingMarkdown || String(node.summary ?? '暂无学习笔记正文。')),
    )

    for (const concept of concepts) {
      const title = asText(concept.name, '')
      const content = asText(concept.explanation, '')
      if (title || content) {
        conceptEntries.push({ lesson: meta, title: title || meta.title, content: content || String(node.summary ?? '') })
      }
    }
    for (const mistake of allMistakes) {
      mistakeEntries.push({ lesson: meta, content: mistake })
    }
    if (practicalSteps.length) {
      practiceEntries.push({ lesson: meta, title: '操作步骤', items: practicalSteps })
    }
    if (practiceTasks.length) {
      practiceEntries.push({ lesson: meta, title: '练习任务', items: practiceTasks })
    }
    if (checkpoints.length) {
      practiceEntries.push({ lesson: meta, title: '过关检查', items: checkpoints })
    }

    const markdown = [
      '---',
      `title: ${escapeYamlString(meta.title)}`,
      'aliases:',
      renderYamlList(uniqueStrings([meta.title, String(node.title ?? meta.title)]), 2),
      `package_id: ${escapeYamlString(packageId)}`,
      `course_title: ${escapeYamlString(courseTitle)}`,
      `node_id: ${escapeYamlString(nodeId)}`,
      `progress_state: ${escapeYamlString(progressState)}`,
      `chapter: ${escapeYamlString(meta.rootTitle)}`,
      `exported_at: ${escapeYamlString(exportedAt)}`,
      'cssclasses:',
      renderYamlList(['shijie-course-note'], 2),
      'tags:',
      renderYamlList(['视界专注', '学习笔记'], 2),
      '---',
      '',
      `# ${meta.title}`,
      '',
      `> [回到视界专注](${buildAppDeepLink(packageId, nodeId)}) · [[${overviewWikiTarget}|学习总览]] · [[${progressWikiTarget}|学习看板]]`,
      ...(previousMeta ? [`> 上一节：[[${previousMeta.wikiTarget}|${previousMeta.title}]]`] : []),
      ...(nextMeta ? [`> 下一节：[[${nextMeta.wikiTarget}|${nextMeta.title}]]`] : []),
      '',
      renderObsidianCallout('info', '学习导航', [
        `- 章节：${meta.rootTitle}`,
        `- 状态：${progressState === 'current' ? '正在学习' : progressState === 'completed' ? '已完成' : '待学习'}`,
        previousMeta ? `- 上一节：[[${previousMeta.wikiTarget}|${previousMeta.title}]]` : '',
        nextMeta ? `- 下一节：[[${nextMeta.wikiTarget}|${nextMeta.title}]]` : '',
      ].filter(Boolean).join('\n')),
      '',
      '## 学习笔记',
      '',
      lessonBody,
      '',
      renderObsidianCallout('question', '主动回忆', quizQuestion || '用自己的话复述这一节的主线。先别看参考回看。'),
      '',
      renderObsidianCallout('success', '参考回看', renderReadableAnswer(standardAnswer), { folded: true }),
      '',
      renderObsidianCalloutList('tip', '关键点', teacherKeyPoints.length ? teacherKeyPoints : objectives),
      '',
      renderObsidianCalloutList('warning', '常见误区', allMistakes),
      '',
      '## 我的笔记',
      '',
      extractMarkdownSection(existingMarkdown, '我的笔记') || '- ',
      '',
    ]
      .join('\n')

    fs.writeFileSync(meta.filePath, markdown, 'utf-8')
  }

  const lessonsByChapter = new Map<string, ObsidianReadableLessonMeta[]>()
  for (const nodeId of lessonOrder) {
    const meta = lessonMetaById.get(nodeId)
    if (!meta) continue
    const current = lessonsByChapter.get(meta.rootTitle) ?? []
    current.push(meta)
    lessonsByChapter.set(meta.rootTitle, current)
  }

  const renderLessonMap = () => Array.from(lessonsByChapter.entries())
    .map(([chapterTitle, lessons]) => [
      `## ${chapterTitle}`,
      '',
      ...lessons.map((lesson) => `- [[${lesson.wikiTarget}|${lesson.title}]]`),
      '',
    ].join('\n'))
    .join('\n')

  const writeAggregateNote = (fileName: string, title: string, body: string) => {
    const filePath = path.join(rootDir, `${fileName}.md`)
    const markdown = [
      '---',
      `title: ${escapeYamlString(title)}`,
      `package_id: ${escapeYamlString(packageId)}`,
      `course_title: ${escapeYamlString(courseTitle)}`,
      `exported_at: ${escapeYamlString(exportedAt)}`,
      'cssclasses:',
      renderYamlList(['shijie-course-note'], 2),
      'tags:',
      renderYamlList(['视界专注', '学习索引'], 2),
      '---',
      '',
      `# ${title}`,
      '',
      `> [[${overviewWikiTarget}|学习总览]]`,
      '',
      body || '- 暂无',
      '',
    ].join('\n')
    fs.writeFileSync(filePath, markdown, 'utf-8')
    return filePath
  }

  const conceptBody = conceptEntries.length
    ? conceptEntries.map((entry) => [
        `## ${entry.title}`,
        '',
        `来源：[[${entry.lesson.wikiTarget}|${entry.lesson.title}]]`,
        '',
        entry.content || '- 暂无说明',
      ].join('\n')).join('\n\n')
    : '- 暂无关键概念'
  const mistakeBody = mistakeEntries.length
    ? Array.from(lessonsByChapter.values()).flat()
        .map((lesson) => {
          const items = mistakeEntries.filter((entry) => entry.lesson.id === lesson.id)
          if (!items.length) return ''
          return [`## [[${lesson.wikiTarget}|${lesson.title}]]`, '', ...items.map((item) => `- ${item.content}`)].join('\n')
        })
        .filter(Boolean)
        .join('\n\n')
    : '- 暂无常见误区'
  const practiceBody = practiceEntries.length
    ? practiceEntries.map((entry) => [
        `## [[${entry.lesson.wikiTarget}|${entry.lesson.title}]] · ${entry.title}`,
        '',
        renderBulletList(entry.items),
      ].join('\n')).join('\n\n')
    : '- 暂无练习或操作整理'

  const conceptPath = writeAggregateNote(conceptNoteTitle, `${courseTitle} · 关键概念`, conceptBody)
  const mistakePath = writeAggregateNote(mistakeNoteTitle, `${courseTitle} · 常见误区`, mistakeBody)
  const practicePath = writeAggregateNote(practiceNoteTitle, `${courseTitle} · 练习与操作`, practiceBody)
  void conceptPath
  void mistakePath
  void practicePath

  const currentMeta = payload.currentNodeId ? lessonMetaById.get(payload.currentNodeId) ?? null : null
  const completedLinks = payload.completedNodeIds
    .map((nodeId) => lessonMetaById.get(nodeId))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)
  const pendingLinks = lessonOrder
    .filter((nodeId) => !payload.completedNodeIds.includes(nodeId))
    .slice(0, 10)
    .map((nodeId) => lessonMetaById.get(nodeId))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)

  const overviewContent = [
    '---',
    `title: ${escapeYamlString(courseTitle)}`,
    'aliases:',
    renderYamlList([courseTitle, `${courseTitle} 学习总览`], 2),
    `package_id: ${escapeYamlString(packageId)}`,
    `source_id: ${escapeYamlString(String(sourceMeta.source_id ?? ''))}`,
    `source_url: ${escapeYamlString(String(sourceMeta.url ?? ''))}`,
    `exported_at: ${escapeYamlString(exportedAt)}`,
    'cssclasses:',
    renderYamlList(['shijie-course-home'], 2),
    'tags:',
    renderYamlList(['视界专注', '学习总览'], 2),
    '---',
    '',
    `# ${courseTitle}`,
    '',
    `> [回到视界专注](${buildAppDeepLink(packageId)}) · [[${progressWikiTarget}|学习看板]]`,
    '',
    renderObsidianCallout('abstract', '学习定位', String(courseMeta.subtitle ?? '') || '暂无学习简介'),
    '',
    renderObsidianCallout('goal', '学习目标', String(courseMeta.overall_goal ?? '暂无总目标')),
    '',
    '## 学习索引',
    '',
    `- [[${courseWikiRoot}/${conceptNoteTitle}|关键概念]]`,
    `- [[${courseWikiRoot}/${mistakeNoteTitle}|常见误区]]`,
    `- [[${courseWikiRoot}/${practiceNoteTitle}|练习与操作]]`,
    '',
    renderObsidianCalloutList('tip', '学习结果', asStringList(courseMeta.learning_outcomes)),
    '',
    '## 学习目录',
    '',
    renderLessonMap() || '- 暂无学习目录',
  ]
    .join('\n')

  const indexPath = path.join(rootDir, `${overviewNoteTitle}.md`)
  fs.writeFileSync(indexPath, overviewContent, 'utf-8')

  const progressPath = path.join(rootDir, `${progressNoteTitle}.md`)
  const existingProgressBoard = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf-8') : ''
  const progressBoardContent = [
    '---',
    `title: ${escapeYamlString(`${courseTitle} 学习看板`)}`,
    `package_id: ${escapeYamlString(packageId)}`,
    `course_title: ${escapeYamlString(courseTitle)}`,
    `exported_at: ${escapeYamlString(exportedAt)}`,
    'cssclasses:',
    renderYamlList(['shijie-course-board'], 2),
    'tags:',
    renderYamlList(['视界专注', '学习看板'], 2),
    '---',
    '',
    `# ${courseTitle} 学习看板`,
    '',
    `> [回到视界专注](${buildAppDeepLink(packageId)}) · [[${overviewWikiTarget}|学习总览]]`,
    '',
    renderObsidianCallout('info', '当前状态', [
      `- 当前小节：${currentMeta ? `[[${currentMeta.wikiTarget}|${currentMeta.title}]]` : '暂无'}`,
      `- 已完成：${payload.completedNodeIds.length} / ${lessonMetaById.size}`,
    ].join('\n')),
    '',
    '## 已完成',
    '',
    completedLinks.length ? completedLinks.join('\n') : '- 还没有完成的小节',
    '',
    '## 接下来可以学',
    '',
    pendingLinks.length ? pendingLinks.join('\n') : '- 所有小节都已经完成',
    '',
    '## 今日阅读记录',
    '',
    extractMarkdownSection(existingProgressBoard, '今日阅读记录') || ['- 今天我最清楚的一点：', '- 今天我最模糊的一点：', '- 下一次打开时，我想先继续哪一节：'].join('\n'),
    '',
  ]
    .join('\n')

  fs.writeFileSync(progressPath, progressBoardContent, 'utf-8')

  const legacyOverviewPath = path.join(rootDir, '00 学习总览.md')
  const legacyProgressPath = path.join(rootDir, '01 学习看板.md')
  if (fs.existsSync(legacyOverviewPath)) fs.unlinkSync(legacyOverviewPath)
  if (fs.existsSync(legacyProgressPath)) fs.unlinkSync(legacyProgressPath)

  return {
    vaultPath,
    rootDir,
    indexPath,
    progressPath,
    currentNodePath: currentMeta?.filePath ?? null,
    fileCount: lessonMetaById.size + 5,
  }
}

export async function openObsidianTarget(
  settings: RuntimeSettings,
  payload: ObsidianExportPayload & { target?: 'current' | 'board' | 'index' },
): Promise<ObsidianOpenResult> {
  const exportResult = exportCourseToObsidian(settings, payload)
  const targetPath =
    payload.target === 'index'
      ? exportResult.indexPath
      : payload.target === 'board'
        ? exportResult.progressPath
        : exportResult.currentNodePath || exportResult.progressPath

  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error('未能定位需要打开的 Obsidian 笔记。')
  }

  const relativePath = path.relative(exportResult.vaultPath, targetPath).replace(/\\/g, '/')
  const vaultName = path.basename(exportResult.vaultPath)
  const openedUri =
    vaultName && relativePath
      ? `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relativePath)}`
      : null

  if (openedUri) {
    try {
      await shell.openExternal(openedUri)
      return {
        ...exportResult,
        openedPath: targetPath,
        openedUri,
        openedVia: 'obsidian-uri',
      }
    } catch {
      // Fall through to local file open below.
    }
  }

  const openPathError = await shell.openPath(targetPath)
  if (openPathError) {
    throw new Error(openPathError)
  }
  return {
    ...exportResult,
    openedPath: targetPath,
    openedUri,
    openedVia: 'file-path',
  }
}
