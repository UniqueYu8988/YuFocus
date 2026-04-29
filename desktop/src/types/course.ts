export type LearningStatus = 'teaching' | 'quizzing' | 'completed'

export type CoachMessageRole = 'system' | 'coach' | 'user'

export type CourseConcept = {
  id: string
  name: string
  explanation: string
  evidence?: string[]
}

export type CourseExample = {
  id: string
  title: string
  scenario: string
  takeaway: string
}

export type KnowledgeBlock = {
  concepts: CourseConcept[]
  examples: CourseExample[]
  checkpoints: string[]
  common_mistakes: string[]
  source_scope?: string[]
  teaching_expansion?: string[]
  practical_steps?: string[]
  practice_tasks?: string[]
  transfer_prompts?: string[]
  enrichment_notes?: string[]
}

export type LessonProfile =
  | 'concept'
  | 'operation'
  | 'tool_config'
  | 'exam'
  | 'case_analysis'
  | 'strategy'
  | 'mixed'

export type TeacherReadyContent = {
  lesson_profile?: LessonProfile
  display_hints?: string[]
  teaching_markdown?: string
  quiz_question?: string
  standard_answer?: string
  key_points?: string[]
  common_mistakes?: string[]
  memory_hook?: string
}

export type SourceRef = {
  kind: 'material_block' | 'subtitle_segment' | 'transcript_excerpt' | 'material_package' | 'note' | 'other'
  label: string
  block_id?: string
  time_range?: {
    from?: number | null
    to?: number | null
  }
  excerpt?: string
  uri?: string
}

export type AssetRef = {
  id: string
  asset_type: string
  title: string
  uri?: string
  status: 'missing' | 'planned' | 'attached'
  related_node_ids?: string[]
}

export type InformationGap = {
  id: string
  gap_type: string
  severity: 'low' | 'medium' | 'high'
  description: string
  affected_node_ids?: string[]
}

export type CourseNode = {
  id: string
  node_type: 'chapter' | 'section' | 'lesson'
  title: string
  summary: string
  order: number
  learning_objectives: string[]
  teacher_ready_content?: TeacherReadyContent
  source_refs?: SourceRef[]
  dependencies: string[]
  knowledge: KnowledgeBlock
  children: CourseNode[]
  assets: AssetRef[]
  gaps: InformationGap[]
}

export type DependencyEdge = {
  from: string
  to: string
  kind: 'prerequisite' | 'recommended' | 'parallel'
  reason?: string
}

export type CoursePackage = {
  schema_version: string
  package_id: string
  source: {
    source_type: string
    source_id: string
    title: string
    creator?: string
    url?: string
    language: string
    ingested_at: string
    text_length: number
    notes?: string
  }
  course: {
    title: string
    subtitle?: string
    overall_goal: string
    target_audience: string
    prerequisites: string[]
    learning_outcomes: string[]
    completion_definition: string
    estimated_total_minutes?: number
  }
  chapters: CourseNode[]
  dependency_graph: DependencyEdge[]
  assets: AssetRef[]
  gaps: InformationGap[]
}

export type FlatCourseNode = CourseNode & {
  parentId: string | null
  depth: number
  childIds: string[]
}

export type CoachMessage = {
  id: string
  role: CoachMessageRole
  content: string
  nodeId?: string
  createdAt: number
}

export type CoachTurnResult = {
  reply: string
  learningStatus: LearningStatus
  markCurrentNodeCompleted: boolean
  suggestedNextNodeId: string | null
}

export type CoachRequestState = 'idle' | 'loading' | 'error'

export type NodeSessionEvaluation = 'correct' | 'partial' | 'incorrect' | null

export type LearningMilestoneKind =
  | 'node_complete'
  | 'stage_complete'
  | 'course_complete'

export type LearningMilestoneEvent = {
  id: string
  kind: LearningMilestoneKind
  title: string
  detail: string
  createdAt: number
  nodeId?: string | null
  stageId?: string | null
  progressPercent?: number
}

export type AchievementBadgeCode =
  | 'first_step'
  | 'steady_stride'
  | 'stage_breaker'
  | 'midway'
  | 'course_finisher'

export type AchievementBadge = {
  code: AchievementBadgeCode
  label: string
  description: string
  tone: 'neutral' | 'info' | 'success' | 'accent'
}

export type NodeLearningSession = {
  nodeId: string
  learningStatus: LearningStatus
  messages: CoachMessage[]
  activeQuestion: string | null
  lastUserAnswer: string
  lastEvaluation: NodeSessionEvaluation
  requestState: CoachRequestState
  error: string | null
  hydrated: boolean
  preloaded: boolean
  updatedAt: number
}

export type PersistedNodeLearningSession = Omit<NodeLearningSession, 'requestState' | 'error'>

export type LearningRecord = {
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
  milestoneEvents: LearningMilestoneEvent[]
  progressPercent: number
  isArchived: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

export type LearningRecordSummary = Omit<LearningRecord, 'courseText' | 'nodeSessions' | 'completedNodeIds' | 'currentNodeId' | 'milestoneEvents'> & {
  currentNodeId: string | null
  currentNodeTitle: string | null
  completedCount: number
  sessionCount: number
  stageCompletedCount: number
  totalStageCount: number
  recentMilestones: LearningMilestoneEvent[]
  achievementBadges: AchievementBadge[]
}

export type LearningLibraryPayload = {
  currentRecordId: string | null
  records: LearningRecordSummary[]
}
