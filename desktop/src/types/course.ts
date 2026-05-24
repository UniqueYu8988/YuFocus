// Learning desk compatibility model.
// Historical Course/Lesson/quiz/standard-answer field names are kept as an
// internal study-package adapter for the React/Electron learning runtime. New
// authoring should describe learning notes, study sections, recall prompts, and
// review references instead of reviving the old course-making workflow.
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
  primary_training_action?: string
  training_focus?: string[]
  teaching_markdown?: string
  // Compatibility fields rendered as active recall and review reference text.
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

export type ChapterRoadmapType =
  | 'workflow'
  | 'concept_map'
  | 'decision_tree'
  | 'operation_flow'
  | 'exam_strategy'
  | 'architecture_map'
  | 'case_reasoning'
  | 'argument_map'
  | 'viewpoint_map'

export type ChapterRoadmapTone =
  | 'green'
  | 'blue'
  | 'purple'
  | 'amber'
  | 'rose'
  | 'neutral'

export type ChapterRoadmapRole =
  | 'foundation'
  | 'concept'
  | 'practice'
  | 'risk'
  | 'decision'
  | 'review'
  | 'integration'

export type ChapterRoadmapNode = {
  id: string
  lesson_id?: string
  title: string
  map_label?: string
  summary?: string
  micro_question?: string
  action_tag?: string
  risk_tag?: string
  output_tag?: string
  core_question?: string
  key_claim?: string
  counterpoint?: string
  completion_signal?: string
  role?: ChapterRoadmapRole
  tone?: ChapterRoadmapTone
}

export type ChapterRoadmapEdge = {
  from: string
  to: string
  kind?: 'next' | 'depends_on' | 'contrast' | 'risk' | 'feedback' | 'supports' | 'tension' | 'counterpoint' | 'tradeoff' | 'open_question'
  label?: string
}

export type ChapterRoadmapVisualAssetStatus = 'planned' | 'attached' | 'missing'

export type ChapterRoadmapHotspot = {
  id: string
  lesson_id?: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export type ChapterRoadmapVisualAsset = {
  asset_id?: string
  kind: 'image'
  uri?: string
  alt: string
  prompt: string
  status: ChapterRoadmapVisualAssetStatus
  hotspots?: ChapterRoadmapHotspot[]
}

export type CourseVisualMapHotspot = {
  id: string
  chapter_id?: string
  lesson_id?: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export type CourseVisualMap = {
  asset_id?: string
  kind: 'image'
  uri?: string
  alt: string
  prompt: string
  status: ChapterRoadmapVisualAssetStatus
  hotspots?: CourseVisualMapHotspot[]
}

export type LightLearningMapRoute = {
  chapter_id: string
  label: string
  title: string
  focus: string
  risk: string
  completion_signal: string
}

export type LightLearningMapNode = {
  lesson_id: string
  label: string
  title: string
  action: string
  risk: string
  signal: string
  high_density: boolean
}

export type LightLearningMapEdge = {
  from: string
  to: string
  label: string
}

export type LightLearningMapChapter = {
  chapter_id: string
  label: string
  title: string
  focus: string
  nodes: LightLearningMapNode[]
  edges: LightLearningMapEdge[]
}

export type LightLearningMap = {
  schema_version: 'shijie.light-learning-map.v0.1'
  course_title: string
  global_route: LightLearningMapRoute[]
  chapter_maps: LightLearningMapChapter[]
}

export type ChapterRoadmapFocusCard = {
  title: string
  bullets: string[]
}

export type ChapterRoadmapTurningPoint = {
  title: string
  from?: string
  to?: string
  reason: string
  lesson_ids?: string[]
}

export type ChapterRoadmapTensionEdge = {
  from: string
  to: string
  label?: string
  tension: string
  resolution_hint?: string
}

export type ChapterRoadmapConflictNode = {
  title: string
  claim: string
  counterpoint: string
  why_it_matters: string
  lesson_ids?: string[]
}

export type ChapterRoadmapOpenQuestion = {
  question: string
  why_it_matters: string
  related_lesson_ids?: string[]
}

export type ChapterRoadmap = {
  roadmap_type: ChapterRoadmapType
  title: string
  subtitle?: string
  visual_asset?: ChapterRoadmapVisualAsset
  nodes: ChapterRoadmapNode[]
  edges?: ChapterRoadmapEdge[]
  focus_cards?: ChapterRoadmapFocusCard[]
  completion_signals?: string[]
  turning_points?: ChapterRoadmapTurningPoint[]
  tension_edges?: ChapterRoadmapTensionEdge[]
  conflict_nodes?: ChapterRoadmapConflictNode[]
  open_questions?: ChapterRoadmapOpenQuestion[]
}

export type PlanDisplayContract = {
  type?: string
  title?: string
  priority?: string
  why_this_format?: string
  must_follow_with?: string
}

export type PlanContract = {
  density_mode?: 'short_precise' | 'normal' | 'high_density' | 'drill'
  can_be_short?: boolean
  must_expand_reason?: string
  primary_training_action?: string
  quality_bar?: string[]
  completion_signals?: string[]
  required_training_slots?: string[]
  avoid_training_slots?: string[]
  required_display_blocks?: PlanDisplayContract[]
  active_recall_requirements?: string[]
  standard_answer_requirements?: string[]
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
  chapter_roadmap?: ChapterRoadmap
  plan_contract?: PlanContract
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
  course_visual_map?: CourseVisualMap
  light_learning_map?: LightLearningMap
  chapters: CourseNode[]
  dependency_graph: DependencyEdge[]
  assets: AssetRef[]
  gaps: InformationGap[]
}

export type StudyPackage = CoursePackage

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
