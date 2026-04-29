import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)))
const projectDir = dirname(desktopDir)

function readFromDesktop(relativePath) {
  return readFileSync(join(desktopDir, relativePath), 'utf8')
}

function readFromProject(relativePath) {
  return readFileSync(join(projectDir, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const learningTurn = readFromDesktop('src/lib/learningTurn.ts')
const courseTypes = readFromDesktop('src/types/course.ts')
const schema = readFromProject('src/schemas/course_package.schema.json')
const materialMvp = readFromProject('src/material_course_mvp.py')
const teacherReady = readFromProject('src/teacher_ready.py')
const distiller = readFromProject('src/distiller.py')

for (const key of ['teaching_markdown', 'quiz_question', 'standard_answer', 'key_points', 'common_mistakes']) {
  assert(courseTypes.includes(key) || schema.includes(`"${key}"`), `course package contract missing ${key}`)
  assert(learningTurn.includes(key), `runtime lesson player does not read ${key}`)
}

for (const forbidden of ['视频给出的范围', '字幕证据', '我会把它补成一节课', '这一关信息量偏高']) {
  assert(!learningTurn.includes(forbidden), `student runtime still contains meta phrase: ${forbidden}`)
}

assert(learningTurn.includes('teacher_ready_content') && learningTurn.includes('teaching_markdown'), 'student teaching must prefer teacher_ready_content')
assert(learningTurn.includes('## 回忆问题'), 'student teaching should end with an active-recall prompt')
assert(learningTurn.includes('## 标准答案'), 'answer review must show the prepared standard answer')
assert(learningTurn.includes('## 关键点'), 'answer review must show prepared key points')
assert(learningTurn.includes('## 常见误区'), 'answer review must show prepared common mistakes')
assert(!learningTurn.includes('missingKeywords'), 'runtime should not perform keyword grading')

assert(materialMvp.includes('teacher_ready_content'), 'material MVP generator must emit teacher_ready_content')
assert(teacherReady.includes('teacher_ready_content') || teacherReady.includes('TeachingProfile'), 'teacher ready builder is not wired')
assert(distiller.includes('Codex 原材料包') || distiller.includes('material package'), 'distiller should be oriented around material packaging')
assert(!materialMvp.includes('MINIMAX_API_KEY'), 'MVP course package generator should not depend on MiniMax for course quality')

console.log('PASS Runtime reads prepared teacher content instead of rebuilding lessons in app.')
console.log('PASS Active recall review is standard-answer based, without remote grading.')
console.log('PASS Material/course generation path is oriented around teacher_ready_content.')
