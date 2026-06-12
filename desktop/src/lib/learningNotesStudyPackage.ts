import type { CourseNode, CoursePackage as StudyPackageCompat, LightLearningMap } from '@/types/course'

type BuildLearningNotesStudyPackageOptions = {
  title: string
  sourceId?: string
  sourceUrl?: string
  materialPath: string
  sourcePath: string
  briefContent: string
  articleHtmlContent?: string
  chapterMapContent?: string
  presentationMode?: 'sections' | 'article'
}

type MarkdownSection = {
  id: string
  title: string
  content: string
  summary: string
  keyPoints: string[]
  articleMode?: boolean
  articleHtml?: string
}

type MarkdownChapter = {
  id: string
  title: string
  content: string
  summary: string
  keyPoints: string[]
  lessons: MarkdownSection[]
  asStudyNode?: boolean
  articleMode?: boolean
  articleHtml?: string
}

function stripKnowledgeBriefMetadata(content: string) {
  return content
    .replace(/^<!--\s*shijie:learning-notes[\s\S]*?-->\s*/u, '')
    .replace(/^<!--\s*shijie:knowledge-brief[\s\S]*?-->\s*/u, '')
    .trim()
}

function normalizeTitle(value: string, fallback: string) {
  return value
    .replace(/[#*_`~>\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback
}

function isMetadataSectionTitle(title: string) {
  const normalized = normalizeTitle(title, '').toLowerCase()
  return normalized === '来源' || normalized === 'source' || normalized === 'metadata'
}

function createStableId(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function makeNodeId(prefix: string, value: string, index: number) {
  return `${prefix}-${String(index + 1).padStart(2, '0')}-${createStableId(value).slice(0, 7)}`
}

function extractCourseTitle(markdown: string, fallbackTitle: string) {
  const titleMatch = markdown.match(/^#\s+(.+?)\s*#*\s*$/mu)
  return normalizeTitle(titleMatch?.[1] ?? fallbackTitle, fallbackTitle)
}

function stripMarkdownNoise(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[。！？!?；;])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function summarizeMarkdown(markdown: string, fallback: string) {
  const plain = stripMarkdownNoise(markdown)
  if (!plain) return fallback
  const sentences = splitSentences(plain)
  const summary = (sentences.length > 0 ? sentences.slice(0, 2).join('') : plain).trim()
  return summary.length > 180 ? `${summary.slice(0, 178)}…` : summary
}

function extractKeyPoints(markdown: string, fallbackTitle: string) {
  const bullets = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+\S/u.test(line))
    .map((line) => stripMarkdownNoise(line))
    .filter((line) => line.length >= 4)
    .slice(0, 6)

  if (bullets.length > 0) return bullets

  const sentences = splitSentences(stripMarkdownNoise(markdown)).filter((line) => line.length >= 8)
  return (sentences.length > 0 ? sentences : [`理解“${fallbackTitle}”的核心逻辑。`]).slice(0, 5)
}

function collectHeadingSections(markdown: string, headingLevel: number) {
  const lines = markdown.split(/\r?\n/u)
  const headingPattern = new RegExp(`^#{${headingLevel}}\\s+(.+?)\\s*#*\\s*$`, 'u')
  const starts: Array<{ index: number; title: string }> = []

  lines.forEach((line, index) => {
    const match = line.match(headingPattern)
    if (match) starts.push({ index, title: normalizeTitle(match[1], `章节 ${starts.length + 1}`) })
  })

  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? lines.length
    const content = lines.slice(start.index, end).join('\n').trim()
    return {
      title: start.title,
      content,
    }
  })
}

function chunkMarkdown(markdown: string, targetLength = 2600) {
  const paragraphs = markdown
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''

  paragraphs.forEach((paragraph) => {
    if (current && `${current}\n\n${paragraph}`.length > targetLength) {
      chunks.push(current)
      current = paragraph
      return
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
  })
  if (current) chunks.push(current)
  return chunks.map((content, index) => ({
    title: `第 ${index + 1} 部分`,
    content: `## 第 ${index + 1} 部分\n\n${content}`,
  }))
}

function splitMarkdownIntoSections(markdown: string): MarkdownSection[] {
  const withoutMainTitle = markdown.replace(/^#\s+.+?\s*#*\s*$/mu, '').trim()
  const rawSections =
    collectHeadingSections(withoutMainTitle, 2).length > 0
      ? collectHeadingSections(withoutMainTitle, 2)
      : collectHeadingSections(withoutMainTitle, 3).length > 0
        ? collectHeadingSections(withoutMainTitle, 3)
        : chunkMarkdown(withoutMainTitle || markdown)

  return rawSections
    .filter((section) => !isMetadataSectionTitle(section.title))
    .filter((section) => stripMarkdownNoise(section.content).length > 40)
    .slice(0, 48)
    .map((section, index) => {
      const title = normalizeTitle(section.title, `章节 ${index + 1}`)
      return {
        id: makeNodeId('brief', `${title}\n${section.content}`, index),
        title,
        content: section.content,
        summary: summarizeMarkdown(section.content, title),
        keyPoints: extractKeyPoints(section.content, title),
      }
    })
}

function makeMarkdownSection(raw: { title: string; content: string }, index: number, prefix = 'brief'): MarkdownSection {
  const title = normalizeTitle(raw.title, `小节 ${index + 1}`)
  return {
    id: makeNodeId(prefix, `${title}\n${raw.content}`, index),
    title,
    content: raw.content,
    summary: summarizeMarkdown(raw.content, title),
    keyPoints: extractKeyPoints(raw.content, title),
  }
}

function makeMarkdownChapterStudyUnit(raw: { title: string; content: string }, index: number): MarkdownChapter {
  const title = normalizeTitle(raw.title, `小节 ${index + 1}`)
  return {
    id: makeNodeId('section', `${title}\n${raw.content}`, index),
    title,
    content: raw.content,
    summary: summarizeMarkdown(raw.content, title),
    keyPoints: extractKeyPoints(raw.content, title),
    lessons: [],
    asStudyNode: true,
  }
}

function getPlainLength(markdown: string) {
  return stripMarkdownNoise(markdown).length
}

function shouldUseCompactDocumentMode(rawChapters: Array<{ title: string; content: string }>, markdown: string) {
  if (rawChapters.length === 0) return false
  const rawLessonCount = rawChapters.reduce((sum, chapter) => sum + collectHeadingSections(chapter.content, 3).length, 0)
  if (rawLessonCount === 0) return true

  const plainLength = getPlainLength(markdown)
  const averageLessonLength = plainLength / Math.max(1, rawLessonCount)
  return rawChapters.length <= 10 && rawLessonCount >= 12 && plainLength <= 14000 && averageLessonLength < 850
}

function shouldCollapseChapterToStudyUnit(
  chapter: { title: string; content: string },
  rawLessons: Array<{ title: string; content: string }>,
) {
  if (rawLessons.length === 0) return true
  const chapterPlainLength = getPlainLength(chapter.content)
  const averageLessonLength =
    rawLessons.reduce((sum, lesson) => sum + getPlainLength(lesson.content), 0) / Math.max(1, rawLessons.length)
  return rawLessons.length >= 6 && chapterPlainLength <= 2200 && averageLessonLength < 420
}

function splitMarkdownIntoChapters(markdown: string): MarkdownChapter[] {
  const withoutMainTitle = markdown.replace(/^#\s+.+?\s*#*\s*$/mu, '').trim()
  const rawChapters = collectHeadingSections(withoutMainTitle, 2)

  if (rawChapters.length === 0) {
    const flatSections = splitMarkdownIntoSections(markdown)
    return flatSections.map((section, index) => ({
      id: getChapterNodeId(section, index),
      title: section.title,
      content: section.content,
      summary: section.summary,
      keyPoints: section.keyPoints,
      lessons: [],
      asStudyNode: true,
    }))
  }

  const compactDocumentMode = shouldUseCompactDocumentMode(rawChapters, withoutMainTitle)

  return rawChapters
    .filter((chapter) => !isMetadataSectionTitle(chapter.title))
    .filter((chapter) => stripMarkdownNoise(chapter.content).length > 40)
    .slice(0, 32)
    .map((chapter, chapterIndex) => {
      const chapterTitle = normalizeTitle(chapter.title, `章节 ${chapterIndex + 1}`)
      const rawLessons = collectHeadingSections(chapter.content, 3)
      if (compactDocumentMode || shouldCollapseChapterToStudyUnit(chapter, rawLessons)) {
        return makeMarkdownChapterStudyUnit({ title: chapterTitle, content: chapter.content }, chapterIndex)
      }

      const lessons = (rawLessons.length > 0
        ? rawLessons.map((lesson, lessonIndex) => makeMarkdownSection(lesson, lessonIndex, `lesson-${chapterIndex + 1}`))
        : [makeMarkdownSection(chapter, 0, `lesson-${chapterIndex + 1}`)]
      ).filter((lesson) => stripMarkdownNoise(lesson.content).length > 30)

      const chapterIntro = chapter.content.split(/^###\s+/mu)[0] || chapter.content
      const summary = summarizeMarkdown(chapterIntro, chapterTitle)
      const keyPoints = extractKeyPoints(chapter.content, chapterTitle)
      return {
        id: makeNodeId('chapter', `${chapterTitle}\n${summary}`, chapterIndex),
        title: chapterTitle,
        content: chapter.content,
        summary,
        keyPoints,
        lessons: lessons.length > 0 ? lessons : [makeMarkdownSection(chapter, 0, `lesson-${chapterIndex + 1}`)],
      }
    })
}

function getChapterNodeId(section: MarkdownSection | MarkdownChapter, index: number) {
  return 'lessons' in section ? section.id : makeNodeId('chapter', `${section.title}\n${section.summary}`, index)
}

function stripLeadingSectionHeading(content: string) {
  return content.replace(/^#{1,3}\s+.+?\s*#*\s*(?:\r?\n)+/u, '').trim()
}

function buildReadableLessonMarkdown(section: MarkdownSection) {
  const content = section.content.trim()
  if (content) return content
  return [`### ${section.title}`, '', section.summary].join('\n')
}

function buildCourseLesson(section: MarkdownSection, order: number): CourseNode {
  const displayHints = section.articleMode
    ? ['video_article', 'chapter_reading', 'article_reading']
    : ['video_article', 'chapter_reading']

  return {
    id: section.id,
    node_type: 'lesson',
    title: section.title,
    summary: section.summary,
    order,
    learning_objectives: [
      `读懂“${section.title}”这一小节。`,
      '理解关键关系、例子和判断方式。',
    ],
    teacher_ready_content: {
      lesson_profile: 'concept',
      display_hints: displayHints,
      primary_training_action: '阅读、理解、建立联系',
      training_focus: section.keyPoints.slice(0, 4),
      teaching_markdown: buildReadableLessonMarkdown(section),
      teaching_html: section.articleHtml,
      quiz_question: '',
      standard_answer: section.summary,
      key_points: section.keyPoints,
      common_mistakes: ['只记住结论，忽略它和前后章节的关系。', '把视频中的例子当成孤立事实，没有还原背后的判断逻辑。'],
    },
    source_refs: [
      {
        kind: 'material_package',
        label: '本地材料包',
      },
    ],
    dependencies: [],
    knowledge: {
      concepts: [],
      examples: [],
      checkpoints: section.keyPoints.slice(0, 4),
      common_mistakes: ['跳读后只留下零散信息，没有形成章节脉络。'],
    },
    children: [],
    assets: [],
    gaps: [],
  }
}

function buildChapterStudyNode(chapter: MarkdownChapter, order: number): CourseNode {
  return buildCourseLesson(
    {
      id: chapter.id,
      title: chapter.title,
      content: chapter.content,
      summary: chapter.summary,
      keyPoints: chapter.keyPoints,
      articleMode: chapter.articleMode,
      articleHtml: chapter.articleHtml,
    },
    order,
  )
}

function buildCourseChapter(chapter: MarkdownChapter, index: number): CourseNode {
  if (chapter.asStudyNode) {
    return buildChapterStudyNode(chapter, index + 1)
  }

  return {
    id: getChapterNodeId(chapter, index),
    node_type: 'chapter',
    title: chapter.title,
    summary: chapter.summary,
    order: index + 1,
    learning_objectives: [
      `读懂“${chapter.title}”这一章。`,
      '把本章和整篇资料的脉络联系起来。',
    ],
    source_refs: [
      {
        kind: 'material_package',
        label: '本地材料包',
      },
    ],
    dependencies: [],
    knowledge: {
      concepts: [],
      examples: [],
      checkpoints: chapter.keyPoints.slice(0, 4),
      common_mistakes: ['只读散点，没有把本章放回全文脉络。'],
    },
    children: chapter.lessons.map((lesson, lessonIndex) => buildCourseLesson(lesson, lessonIndex + 1)),
    assets: [],
    gaps: [],
  }
}

function buildLightLearningMap(title: string, chapters: MarkdownChapter[]): LightLearningMap {
  return {
    schema_version: 'shijie.light-learning-map.v0.1',
    course_title: title,
    global_route: chapters.map((chapter, index) => ({
      chapter_id: getChapterNodeId(chapter, index),
      label: chapter.asStudyNode ? `第 ${index + 1} 节` : `第 ${index + 1} 章`,
      title: chapter.title,
      focus: chapter.summary,
      risk: '',
      completion_signal: '',
    })),
    chapter_maps: chapters.map((chapter, index) => {
      const mapNodes: MarkdownSection[] = chapter.asStudyNode
        ? [{
            id: chapter.id,
            title: chapter.title,
            content: chapter.content,
            summary: chapter.summary,
            keyPoints: chapter.keyPoints,
          }]
        : chapter.lessons

      return {
        chapter_id: getChapterNodeId(chapter, index),
        label: chapter.asStudyNode ? `第 ${index + 1} 节` : `第 ${index + 1} 章`,
        title: chapter.title,
        focus: chapter.summary,
        nodes: mapNodes.map((lesson) => ({
          lesson_id: lesson.id,
          label: lesson.title,
          title: lesson.title,
          action: '阅读',
          risk: '',
          signal: '',
          high_density: lesson.content.length > 2800,
        })),
        edges: chapter.asStudyNode ? [] : chapter.lessons.slice(0, -1).map((lesson, lessonIndex) => ({
          from: lesson.id,
          to: chapter.lessons[lessonIndex + 1].id,
          label: '继续',
        })),
      }
    }),
  }
}

export function buildLearningNotesStudyPackage(options: BuildLearningNotesStudyPackageOptions): StudyPackageCompat {
  const cleanBrief = stripKnowledgeBriefMetadata(options.briefContent)
  const courseTitle = extractCourseTitle(cleanBrief, options.title || '未命名资料')
  const chapters = options.presentationMode === 'article'
    ? []
    : splitMarkdownIntoChapters(cleanBrief)
  const fallbackSection = {
    id: makeNodeId('brief', cleanBrief || courseTitle, 0),
    title: courseTitle,
    content: cleanBrief || `# ${courseTitle}`,
    summary: summarizeMarkdown(cleanBrief, courseTitle),
    keyPoints: extractKeyPoints(cleanBrief, courseTitle),
    articleMode: options.presentationMode === 'article',
    articleHtml: options.presentationMode === 'article' ? options.articleHtmlContent?.trim() : undefined,
  }
  const safeChapters = chapters.length > 0
    ? chapters
    : [{
        ...fallbackSection,
        id: getChapterNodeId(fallbackSection, 0),
        lessons: [],
        asStudyNode: true,
      }]
  const packageId = `study-package-${createStableId(`${courseTitle}\n${options.sourceId ?? ''}\n${options.materialPath}`)}`
  const textLength = cleanBrief.length
  const chapterMap = options.chapterMapContent?.trim() ?? ''

  // The data desk still consumes the historical CoursePackage object shape.
  // External metadata names this artifact as a study package created from a source record.
  return {
    schema_version: 'shijie.study-package.v0.1',
    package_id: packageId,
    source: {
      source_type: 'video_article',
      source_id: options.sourceId || packageId,
      title: courseTitle,
      url: options.sourceUrl,
      language: 'zh-CN',
      ingested_at: new Date().toISOString(),
      text_length: textLength,
      notes: `由本地资料包导入专注页。资料包：${options.materialPath}`,
    },
    course: {
      title: courseTitle,
      subtitle: '专注页兼容包',
      overall_goal: '按章节阅读、复述并建立视频内容中的信息联系。',
      target_audience: '希望把视频内容沉淀为系统理解的学习者。',
      prerequisites: [],
      learning_outcomes: [
        '能按章节复述资料脉络。',
        '能说清关键概念之间的关系。',
        '能把视频中的例子、判断和结论重新组织成自己的理解。',
      ],
      completion_definition: '完成所有章节阅读，并能用自己的话复述每章的核心判断。',
      estimated_total_minutes: Math.max(8, Math.ceil(textLength / 650)),
    },
    course_visual_map: chapterMap
      ? {
          kind: 'image',
          alt: `${courseTitle} 的结构图`,
          prompt: chapterMap,
          status: 'planned',
        }
      : undefined,
    light_learning_map: buildLightLearningMap(courseTitle, safeChapters),
    chapters: safeChapters.map((chapter, index) => buildCourseChapter(chapter, index)),
    dependency_graph: [],
    assets: [],
    gaps: [],
  }
}
