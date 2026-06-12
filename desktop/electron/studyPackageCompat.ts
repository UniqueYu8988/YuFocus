import fs from 'node:fs'
import path from 'node:path'

// Historical study-package compatibility. Keep this isolated from the current API-driven video pipeline.
const COURSE_MAX_ROOT_CHAPTERS = 24
const COURSE_MICRO_ROOT_LESSON_THRESHOLD = 2
const COURSE_TARGET_GROUP_LEAF_LESSONS = 8
const COURSE_STAGE_THEME_HINTS: Array<{ label: string; keywords: string[] }> = [
  { label: '正则表达式与文本匹配', keywords: ['正则', 'regex', '匹配', '量词', '分组', '贪婪', '非贪婪', '字符类'] },
  { label: '综合练习与项目演练', keywords: ['练习', '项目', '综合应用', '案例', '实训', '题目', '巩固'] },
  { label: '网络请求与爬虫基础', keywords: ['爬虫', 'http', 'https', 'url', 'robots', 'requests', '请求', '响应', '网页'] },
  { label: '数据解析与存储实践', keywords: ['json', 'xpath', 'jsonpath', 'excel', 'csv', '数据库', 'pymongo', '存储', '解析'] },
  { label: '并发异步与采集实战', keywords: ['协程', '并发', '异步', 'aio', '采集', '壁纸', '音乐爬虫', '批量'] },
  { label: '逆向分析与调试实战', keywords: ['逆向', '加密', '断点', '调用栈', '翻译', '网易云', 'js', '调试'] },
  { label: '图形界面与工具模块', keywords: ['tkinter', '图形界面', 'random', '随机数', '界面开发'] },
  { label: '基础入门与语法起步', keywords: ['环境', '安装', '配置', '入门', '基础', '起步', '认识', '准备', '变量', '赋值', '输入', '输出'] },
  { label: '语法规则与流程控制', keywords: ['条件', '判断', 'if', 'else', '循环', 'for', 'while', 'break', 'continue', '运算符', '比较', '逻辑'] },
  { label: '字符串与常用数据结构', keywords: ['字符串', '列表', '元组', '字典', '集合', '切片', '序列', '编码'] },
  { label: '函数设计与作用域', keywords: ['函数', '参数', '返回值', 'lambda', '闭包', '递归', '作用域', '匿名'] },
  { label: '模块化与面向对象', keywords: ['模块', '包', '类', '对象', '封装', '继承', '多态', '魔术方法', '异常'] },
  { label: '文件处理与工程实践', keywords: ['文件', '路径', '读写', 'io', '目录', '项目', '实战', '综合', '案例'] },
  { label: '诊疗规范与基本操作', keywords: ['无菌', '消毒', '洗手', '戴手套', '操作', '检查', '口腔', '诊疗', '护理'] },
  { label: '病例判断与临床思路', keywords: ['病例', '病因', '症状', '诊断', '鉴别', '治疗', '并发症', '临床', '病变'] },
]
const COURSE_TEACHING_FLOW_BUCKET_HINTS: Array<{ bucket: number; keywords: string[] }> = [
  { bucket: 0, keywords: ['导学', '导论', '入门', '起步', '概览', '总览', '先导', '认识', '基础'] },
  { bucket: 1, keywords: ['概念', '定义', '原理', '本质', '规则', '特点', '核心', '理解'] },
  { bucket: 2, keywords: ['例子', '示例', '案例', '演示', '场景', '体验'] },
  { bucket: 3, keywords: ['操作', '实战', '练习', '使用', '流程', '步骤', '方法', '配置', '上手', '技巧'] },
  { bucket: 4, keywords: ['易错', '错误', '误区', '陷阱', '注意', '禁忌', '风险'] },
  { bucket: 5, keywords: ['复盘', '回顾', '总结', '练习', '测验', '自检', '检查'] },
]

function normalizeCourseTextValue(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function takeUniqueCourseTexts(values: unknown[], limit = 4) {
  const items: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const text = normalizeCourseTextValue(value)
    if (!text) continue
    const marker = text.toLocaleLowerCase('zh-CN')
    if (seen.has(marker)) continue
    seen.add(marker)
    items.push(text)
    if (items.length >= limit) break
  }
  return items
}

function countLeafLessons(node: Record<string, unknown>): number {
  const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
  if (!children.length) {
    return node.node_type === 'lesson' ? 1 : 0
  }
  const total: number = children.reduce((sum, child) => sum + countLeafLessons(child), 0)
  return total || (node.node_type === 'lesson' ? 1 : 0)
}

function deriveGroupTheme(nodes: Array<Record<string, unknown>>, groupIndex: number) {
  const titles = nodes
    .map((node) => normalizeCourseTextValue(node.title))
    .filter(Boolean)
  if (!titles.length) return `学习阶段 ${String(groupIndex).padStart(2, '0')}`
  const commonPrefix = titles.reduce((prefix, title) => {
    if (!prefix) return title
    let length = 0
    while (length < prefix.length && length < title.length && prefix[length] === title[length]) {
      length += 1
    }
    return prefix.slice(0, length)
  }, titles[0]).trim().replace(/[ ·|:：,，、-]+$/g, '')
  if (commonPrefix.length >= 4) return commonPrefix.slice(0, 24)
  return titles[0].slice(0, 20)
}

function deriveGroupThemeFromHints(nodes: Array<Record<string, unknown>>) {
  const labels: Array<{ weight: number; text: string }> = []
  for (const node of nodes) {
    const title = normalizeCourseTextValue(node.title)
    const summary = normalizeCourseTextValue(node.summary)
    if (title) labels.push({ weight: 3, text: title })
    if (summary) labels.push({ weight: 1, text: summary })
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && typeof child === 'object') {
          const childTitle = normalizeCourseTextValue((child as Record<string, unknown>).title)
          if (childTitle) labels.push({ weight: 2, text: childTitle })
        }
      }
    }
  }

  if (!labels.length) return ''

  const scored = COURSE_STAGE_THEME_HINTS
    .map((hint) => ({
      label: hint.label,
      score: labels.reduce((count, item) => {
        const lowered = item.text.toLocaleLowerCase('zh-CN')
        return count + hint.keywords.reduce((sum, keyword) => sum + (lowered.includes(keyword.toLocaleLowerCase('zh-CN')) ? item.weight : 0), 0)
      }, 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => (right.score - left.score) || left.label.localeCompare(right.label, 'zh-CN'))

  return scored[0]?.label || ''
}

function buildStageTitle(nodes: Array<Record<string, unknown>>, groupIndex: number) {
  const hintedTheme = deriveGroupThemeFromHints(nodes)
  if (hintedTheme) {
    return `阶段 ${String(groupIndex).padStart(2, '0')} · ${hintedTheme}`
  }

  let theme = deriveGroupTheme(nodes, groupIndex)
  const uniqueTitles = takeUniqueCourseTexts(nodes.map((node) => node.title), 3)
  if (uniqueTitles.length >= 2 && theme.length < 5) {
    theme = uniqueTitles.slice(0, 2).join('、')
  }
  return `阶段 ${String(groupIndex).padStart(2, '0')} · ${theme}`
}

function refreshExistingStageTitles(chapters: Array<Record<string, unknown>>) {
  let changed = false
  const refreshed = chapters.map((chapter, index) => {
    const title = normalizeCourseTextValue(chapter.title)
    const children = Array.isArray(chapter.children) ? (chapter.children as Array<Record<string, unknown>>) : []
    if (!children.length || !(title.startsWith('学习阶段 ') || title.startsWith('阶段 '))) {
      return chapter
    }

    const nextTitle = buildStageTitle(children, index + 1)
    const nextSummary = buildStageSummary(children).slice(0, 240)
    const nextObjectives = buildStageLearningObjectives(children, nextTitle)
    const nextChapter = {
      ...JSON.parse(JSON.stringify(chapter)),
      title: nextTitle.slice(0, 120),
      summary: nextSummary,
      learning_objectives: nextObjectives,
      knowledge: buildStageKnowledge(String(chapter.id || nextTitle), nextTitle, nextSummary),
    }
    changed = changed || nextTitle !== title || nextSummary !== normalizeCourseTextValue(chapter.summary)
    return nextChapter
  })

  return { chapters: refreshed, changed }
}

function dedupeStageTitles(chapters: Array<Record<string, unknown>>) {
  const suffixes = ['进阶', '实战', '综合', '拓展']
  const seen = new Map<string, number>()
  let changed = false

  const refreshed = chapters.map((chapter) => {
    const title = normalizeCourseTextValue(chapter.title)
    const themePart = title.includes(' · ') ? title.split(' · ').slice(1).join(' · ') : title
    const titleKey = themePart || title
    const count = seen.get(titleKey) ?? 0
    seen.set(titleKey, count + 1)
    if (!title || count === 0) {
      return chapter
    }

    const suffix = suffixes[Math.min(count - 1, suffixes.length - 1)]
    const nextTitle = `${title} · ${suffix}`
    const children = Array.isArray(chapter.children) ? (chapter.children as Array<Record<string, unknown>>) : []
    const nextChapter = {
      ...JSON.parse(JSON.stringify(chapter)),
      title: nextTitle.slice(0, 120),
    }
    if (children.length) {
      nextChapter.learning_objectives = buildStageLearningObjectives(children, nextTitle)
      nextChapter.knowledge = buildStageKnowledge(String(chapter.id || nextTitle), nextTitle, normalizeCourseTextValue(chapter.summary))
    }
    changed = true
    return nextChapter
  })

  return { chapters: refreshed, changed }
}

function buildStageSummary(nodes: Array<Record<string, unknown>>) {
  const titles = takeUniqueCourseTexts(nodes.map((node) => node.title), 4)
  if (!titles.length) return '把相邻的小节整理为一个更清晰的学习阶段。'
  if (titles.length === 1) return `围绕 ${titles[0]} 展开这一阶段的核心学习主线。`
  return `这一阶段集中学习 ${titles.slice(0, 3).join('、')}${titles.length > 3 ? ' 等内容' : ''}，减少碎片化切换。`
}

function buildStageLearningObjectives(nodes: Array<Record<string, unknown>>, stageTitle: string) {
  const labels: unknown[] = [`建立 ${stageTitle} 的整体主线`]
  for (const node of nodes) {
    labels.push(node.title)
    if (Array.isArray(node.children)) {
      for (const child of node.children.slice(0, 2)) {
        if (child && typeof child === 'object') {
          labels.push((child as Record<string, unknown>).title)
        }
      }
    }
  }
  return takeUniqueCourseTexts(labels, 4)
}

function collectNodeTextFragments(node: Record<string, unknown>) {
  const knowledge = node.knowledge && typeof node.knowledge === 'object' ? (node.knowledge as Record<string, unknown>) : {}
  return [
    normalizeCourseTextValue(node.title),
    normalizeCourseTextValue(node.summary),
    ...((Array.isArray(knowledge.checkpoints) ? knowledge.checkpoints : []).map((item) => normalizeCourseTextValue(item))),
    ...((Array.isArray(knowledge.common_mistakes) ? knowledge.common_mistakes : []).map((item) => normalizeCourseTextValue(item))),
  ].filter(Boolean)
}

function inferTeachingFlowBucket(node: Record<string, unknown>) {
  const haystack = collectNodeTextFragments(node).join(' ').toLocaleLowerCase('zh-CN')
  if (!haystack) return 3
  for (const hint of COURSE_TEACHING_FLOW_BUCKET_HINTS) {
    if (hint.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase('zh-CN')))) {
      return hint.bucket
    }
  }
  return 3
}

function resequenceChildren(children: Array<Record<string, unknown>>) {
  const siblingIds = new Set(
    children.map((child) => normalizeCourseTextValue(child.id)).filter(Boolean),
  )
  let previousId = ''
  return children.map((child, index) => {
    const childId = normalizeCourseTextValue(child.id)
    const dependencies = Array.isArray(child.dependencies) ? child.dependencies : []
    const externalDependencies = dependencies
      .map((item) => normalizeCourseTextValue(item))
      .filter((item) => item && item !== childId && !siblingIds.has(item))
    if (previousId) externalDependencies.push(previousId)
    const nextChild = {
      ...JSON.parse(JSON.stringify(child)),
      order: index + 1,
      dependencies: takeUniqueCourseTexts(externalDependencies, 8),
    }
    if (childId) previousId = childId
    return nextChild
  })
}

function isStageRecapNode(node: Record<string, unknown>) {
  const title = normalizeCourseTextValue(node.title).toLocaleLowerCase('zh-CN')
  return Boolean(title) && (title.includes('阶段复盘') || title.includes('阶段练习') || ['复盘', '练习', '回顾'].includes(title))
}

function restructureNodeForTeachingFlow(node: Record<string, unknown>, isRootStage = false): { node: Record<string, unknown>; changed: boolean } {
  const children = Array.isArray(node.children) ? (node.children as Array<Record<string, unknown>>) : []
  if (!children.length) {
    return { node: JSON.parse(JSON.stringify(node)), changed: false }
  }

  let changed = false
  const nextNode = JSON.parse(JSON.stringify(node)) as Record<string, unknown>
  let processedChildren = children.map((child) => {
    const result = restructureNodeForTeachingFlow(child, false)
    changed = changed || result.changed
    return result.node
  })

  const lessonOnlyChildren = processedChildren.length > 0 && processedChildren.every((child) => child.node_type === 'lesson')
  if (lessonOnlyChildren) {
    const sortedChildren = [...processedChildren].sort((left, right) => {
      const bucketDiff = inferTeachingFlowBucket(left) - inferTeachingFlowBucket(right)
      if (bucketDiff !== 0) return bucketDiff
      return Number(left.order || 0) - Number(right.order || 0)
    })
    const originalIds = processedChildren.map((child) => normalizeCourseTextValue(child.id)).join('|')
    const nextIds = sortedChildren.map((child) => normalizeCourseTextValue(child.id)).join('|')
    if (originalIds !== nextIds) {
      processedChildren = sortedChildren
      changed = true
    }
  }

  if (isRootStage) {
    const baseChildren = processedChildren.filter((child) => !isStageRecapNode(child))
    if (baseChildren.length !== processedChildren.length) {
      processedChildren = baseChildren
      changed = true
    }
  }

  const resequenced = resequenceChildren(processedChildren)
  if (JSON.stringify(processedChildren.map((child) => [child.order, child.dependencies])) !== JSON.stringify(resequenced.map((child) => [child.order, child.dependencies]))) {
    changed = true
  }

  nextNode.children = resequenced
  return { node: nextNode, changed }
}

function restructureCourseRootsForTeachingFlow(chapters: Array<Record<string, unknown>>) {
  let changed = false
  const nextRoots = chapters.map((chapter) => {
    const result = restructureNodeForTeachingFlow(chapter, true)
    changed = changed || result.changed
    return result.node
  })
  return { chapters: nextRoots, changed }
}

function collectCourseNodeIds(chapters: Array<Record<string, unknown>>) {
  const ids = new Set<string>()
  const visit = (node: Record<string, unknown>) => {
    const id = normalizeCourseTextValue(node.id)
    if (id) ids.add(id)
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => {
        if (child && typeof child === 'object') visit(child as Record<string, unknown>)
      })
    }
  }
  chapters.forEach(visit)
  return ids
}

function filterDependencyGraphByNodeIds(dependencyGraph: unknown, nodeIds: Set<string>) {
  if (!Array.isArray(dependencyGraph)) return []
  return dependencyGraph.filter((edge) => {
    if (!edge || typeof edge !== 'object') return false
    const record = edge as Record<string, unknown>
    const from = normalizeCourseTextValue(record.from)
    const to = normalizeCourseTextValue(record.to)
    return Boolean(from && to && nodeIds.has(from) && nodeIds.has(to))
  })
}

function makeCourseNodeId(kind: 'chapter' | 'section' | 'lesson', index: number, title: string, parentId = '') {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18) || `${kind}_${index}`
  return parentId ? `${parentId}.${kind[0]}${String(index).padStart(2, '0')}_${slug}`.slice(0, 64) : `${kind.slice(0, 2)}${String(index).padStart(2, '0')}_${slug}`.slice(0, 64)
}

function buildStageKnowledge(stageId: string, title: string, summary: string): {
  concepts: Array<Record<string, unknown>>
  examples: Array<Record<string, unknown>>
  checkpoints: string[]
  common_mistakes: string[]
} {
  return {
    concepts: [
      {
        id: `concept_${stageId.slice(0, 20)}_01`.slice(0, 64),
        name: title.slice(0, 64),
        explanation: summary.slice(0, 240) || `围绕 ${title} 展开的阶段主线。`,
        evidence: [],
      },
    ],
    examples: [
      {
        id: `example_${stageId.slice(0, 20)}_01`.slice(0, 64),
        title: title.slice(0, 64),
        scenario: summary.slice(0, 180) || `这一阶段会覆盖 ${title} 的关键内容。`,
        takeaway: takeUniqueCourseTexts([title, summary], 1)[0] || title,
      },
    ],
    checkpoints: takeUniqueCourseTexts([`能说清 ${title} 这一阶段的主线。`, summary], 3),
    common_mistakes: [],
  }
}

function groupRootChapters(chapters: Array<Record<string, unknown>>) {
  if (chapters.length <= COURSE_MAX_ROOT_CHAPTERS) {
    return chapters.map((chapter) => [chapter])
  }

  const groups: Array<Array<Record<string, unknown>>> = []
  let buffer: Array<Record<string, unknown>> = []
  let bufferLessons = 0

  for (const chapter of chapters) {
    const leafLessons = Math.max(1, countLeafLessons(chapter))
    const isMicro = leafLessons <= COURSE_MICRO_ROOT_LESSON_THRESHOLD

    if (isMicro) {
      buffer.push(chapter)
      bufferLessons += leafLessons
      if (buffer.length >= 2 && bufferLessons >= COURSE_TARGET_GROUP_LEAF_LESSONS) {
        groups.push(buffer)
        buffer = []
        bufferLessons = 0
      }
      continue
    }

    if (buffer.length) {
      if (bufferLessons + leafLessons <= COURSE_TARGET_GROUP_LEAF_LESSONS || buffer.length === 1) {
        buffer.push(chapter)
        groups.push(buffer)
        buffer = []
        bufferLessons = 0
      } else {
        groups.push(buffer)
        buffer = []
        bufferLessons = 0
        groups.push([chapter])
      }
    } else {
      groups.push([chapter])
    }
  }

  if (buffer.length) groups.push(buffer)
  if (groups.length <= COURSE_MAX_ROOT_CHAPTERS) return groups

  const merged: Array<Array<Record<string, unknown>>> = []
  const mergeSpan = Math.max(2, Math.ceil(groups.length / COURSE_MAX_ROOT_CHAPTERS))
  for (let index = 0; index < groups.length; index += mergeSpan) {
    merged.push(groups.slice(index, index + mergeSpan).flat())
  }
  return merged
}

export function compactStudyPackagePayload(payload: Record<string, unknown>): {
  payload: Record<string, unknown>
  changed: boolean
} {
  const chapters = Array.isArray(payload.chapters) ? (payload.chapters as Record<string, unknown>[]) : []
  if (chapters.length <= COURSE_MAX_ROOT_CHAPTERS) {
    const refreshed = refreshExistingStageTitles(chapters)
    const deduped = dedupeStageTitles(refreshed.chapters)
    const restructured = restructureCourseRootsForTeachingFlow(deduped.chapters)
    const nextChapters = restructured.chapters
    if (!refreshed.changed) {
      if (!deduped.changed && !restructured.changed) {
        return { payload, changed: false }
      }
    }

    const nextCourse = { ...((payload.course as Record<string, unknown>) || {}) }
    const validNodeIds = collectCourseNodeIds(nextChapters)
    nextCourse.learning_outcomes = takeUniqueCourseTexts(
      [
        ...nextChapters.slice(0, 4).map((item) => item.title),
        ...nextChapters.flatMap((item) =>
          Array.isArray(item.children)
            ? item.children.slice(0, 1).map((child: unknown) => (child as Record<string, unknown>).title)
            : [],
        ),
      ],
      6,
    )

    return {
      payload: {
        ...payload,
        course: nextCourse,
        chapters: nextChapters,
        dependency_graph: filterDependencyGraphByNodeIds(payload.dependency_graph, validNodeIds),
      },
      changed: true,
    }
  }

  const grouped = groupRootChapters(chapters)
  if (grouped.length >= chapters.length) {
    return { payload, changed: false }
  }

  const compactedRoots: Array<Record<string, unknown>> = []
  for (let rootIndex = 0; rootIndex < grouped.length; rootIndex += 1) {
    const chapterGroup = grouped[rootIndex]
    if (chapterGroup.length === 1 && grouped.length <= COURSE_MAX_ROOT_CHAPTERS) {
      compactedRoots.push({
        ...JSON.parse(JSON.stringify(chapterGroup[0])),
        order: rootIndex + 1,
      })
      continue
    }

    const stageTitle = buildStageTitle(chapterGroup, rootIndex + 1)
    const stageId = makeCourseNodeId('chapter', rootIndex + 1, stageTitle)
    const summary = buildStageSummary(chapterGroup)
    compactedRoots.push({
      id: stageId,
      node_type: 'chapter',
      title: stageTitle.slice(0, 120),
      summary: summary.slice(0, 240),
      order: rootIndex + 1,
      learning_objectives: buildStageLearningObjectives(chapterGroup, stageTitle),
      dependencies: compactedRoots.length ? [String(compactedRoots[compactedRoots.length - 1].id)] : [],
      knowledge: buildStageKnowledge(stageId, stageTitle, summary),
      children: chapterGroup.map((chapter, sectionIndex) => ({
        ...JSON.parse(JSON.stringify(chapter)),
        node_type: 'section',
        order: sectionIndex + 1,
      })),
      assets: [],
      gaps: [],
    })
  }

  const dedupedRoots = dedupeStageTitles(compactedRoots)
  compactedRoots.length = 0
  compactedRoots.push(...restructureCourseRootsForTeachingFlow(dedupedRoots.chapters).chapters)

  const validNodeIds = collectCourseNodeIds(compactedRoots)
  const dependencyGraph = filterDependencyGraphByNodeIds(payload.dependency_graph, validNodeIds)
  const markers = new Set(
    dependencyGraph
      .filter((item: unknown) => item && typeof item === 'object')
      .map((item: unknown) => JSON.stringify(item)),
  )
  for (let index = 1; index < compactedRoots.length; index += 1) {
    const edge = {
      from: compactedRoots[index - 1].id,
      to: compactedRoots[index].id,
      kind: 'recommended',
      reason: '压缩顶层主线后，按阶段顺序推进更容易建立整体框架。',
    }
    const marker = JSON.stringify(edge)
    if (!markers.has(marker)) {
      dependencyGraph.push(edge)
      markers.add(marker)
    }
  }

  const nextCourse = { ...((payload.course as Record<string, unknown>) || {}) }
  nextCourse.learning_outcomes = takeUniqueCourseTexts(
    [
      ...compactedRoots.slice(0, 4).map((item) => item.title),
      ...compactedRoots.flatMap((item) =>
        Array.isArray(item.children) ? item.children.slice(0, 1).map((child) => (child as Record<string, unknown>).title) : [],
      ),
    ],
    6,
  )

  return {
    changed: true,
    payload: {
      ...payload,
      course: nextCourse,
      chapters: compactedRoots,
      dependency_graph: dependencyGraph,
    },
  }
}

export function normalizeStudyPackageText(courseText: string, targetPath?: string | null) {
  if (!courseText.trim()) return { text: courseText, changed: false }
  try {
    const parsed = JSON.parse(courseText) as Record<string, unknown>
    const compacted = compactStudyPackagePayload(parsed)
    if (!compacted.changed) {
      return { text: courseText, changed: false }
    }
    const nextText = JSON.stringify(compacted.payload, null, 2)
    const writableTargetPath = isWritableStudyPackagePath(targetPath) ? String(targetPath).trim() : ''
    if (writableTargetPath) {
      try {
        fs.writeFileSync(writableTargetPath, nextText, 'utf-8')
      } catch {
        // ignore package write-back failures and still return upgraded text
      }
    }
    return { text: nextText, changed: true }
  } catch {
    return { text: courseText, changed: false }
  }
}

export function isWritableStudyPackagePath(targetPath?: string | null) {
  const normalized = String(targetPath ?? '').trim()
  if (!normalized) return false
  return path.extname(normalized).toLowerCase() === '.json'
}
