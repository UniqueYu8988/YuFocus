import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))

function read(relativePath) {
  return readFileSync(join(rootDir, relativePath), 'utf8')
}

const files = {
  types: read('src/types/course.ts'),
  learningTurn: read('src/lib/learningTurn.ts'),
  store: read('src/store.ts'),
  coachPane: read('src/components/CoachPane.tsx'),
  coachComposer: read('src/components/CoachComposer.tsx'),
  timeline: read('src/components/CoachChatTimeline.tsx'),
  workspace: read('src/components/WorkspacePane.tsx'),
}

const checks = [
  {
    name: 'LearningStatus stays linear',
    pass:
      files.types.includes("export type LearningStatus = 'teaching' | 'quizzing' | 'completed'") &&
      !files.types.includes("'correcting'"),
  },
  {
    name: 'Removed wrong-answer system data model',
    pass:
      !files.types.includes('QuizAttemptInsight') &&
      !files.types.includes('attemptHistory') &&
      !files.store.includes('appendAttemptInsight') &&
      !files.store.includes('attemptHistory'),
  },
  {
    name: 'Runtime has no remote coach API path',
    pass:
      !files.store.includes('requestCoachTurn') &&
      !files.store.includes('resolveCoachApiConfig') &&
      !files.store.includes('coachApi') &&
      !files.learningTurn.includes('coachPrompt'),
  },
  {
    name: 'Runtime teaches from teacher_ready_content',
    pass:
      files.learningTurn.includes('teaching_markdown') &&
      files.learningTurn.includes('standard_answer') &&
      files.learningTurn.includes('key_points') &&
      files.learningTurn.includes('common_mistakes'),
  },
  {
    name: 'Fallback teaching turn waits for active recall',
    pass:
      files.learningTurn.includes("if (learningStatus === 'teaching' && !answer.trim())") &&
      files.learningTurn.includes("learningStatus: 'quizzing'") &&
      files.learningTurn.includes('## 回忆问题'),
  },
  {
    name: 'Answer turn always closes the node',
    pass:
      files.learningTurn.includes("learningStatus: 'completed'") &&
      files.learningTurn.includes('markCurrentNodeCompleted: true') &&
      files.learningTurn.includes('suggestedNextNodeId: nextNode?.id ?? null') &&
      files.learningTurn.includes('标准答案'),
  },
  {
    name: 'Composer is active-recall only',
    pass:
      !files.coachComposer.includes('onStartQuiz') &&
      !files.coachComposer.includes('canStartQuiz') &&
      !files.coachComposer.includes('小测') &&
      files.coachComposer.includes('先写下你的回忆，再对照标准答案'),
  },
  {
    name: 'Student timeline renders one lesson message',
    pass:
      files.timeline.includes('<MarkdownRenderer') &&
      files.timeline.includes('hideLeadHeading') &&
      !files.timeline.includes('MemoryAidDialog') &&
      !files.store.includes('generateMemoryAidForCurrentNode'),
  },
  {
    name: 'Main workspace does not expose coach API settings',
    pass:
      !files.workspace.includes('coach_api') &&
      !files.workspace.includes('distiller_api') &&
      !files.workspace.includes('groq_api') &&
      !files.workspace.includes('MiniMax'),
  },
]

const failed = checks.filter((check) => !check.pass)

for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
}

if (failed.length > 0) {
  console.error(`\nLearning-flow regression failed: ${failed.length} check(s) failed.`)
  process.exit(1)
}

console.log('\nLearning-flow regression checks passed.')
