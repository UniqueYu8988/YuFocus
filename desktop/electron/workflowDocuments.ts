import fs from 'node:fs'
import path from 'node:path'

const WORKFLOW_DOCUMENTS = {
  project_context: {
    title: '项目语境',
    relativePath: 'PROJECT_CONTEXT.md',
  },
  editorial_pipeline: {
    title: '编稿流程',
    relativePath: path.join('docs', 'video-editorial-pipeline.md'),
  },
  system_optimization_audit: {
    title: '系统优化审计',
    relativePath: path.join('docs', 'system-optimization-audit.md'),
  },
  cleanup_baseline: {
    title: '清理基线',
    relativePath: path.join('docs', 'cleanup-baseline.md'),
  },
  email_contract: {
    title: '邮件合同检查',
    relativePath: path.join('src', 'check_editorial_email_contract.py'),
  },
  distiller_core: {
    title: 'distiller 核心逻辑',
    relativePath: path.join('src', 'distiller.py'),
  },
} as const

export type WorkflowDocumentKey = keyof typeof WORKFLOW_DOCUMENTS

function isWorkflowDocumentKey(value: unknown): value is WorkflowDocumentKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WORKFLOW_DOCUMENTS, value)
}

export function readWorkflowDocument(projectRootInput: string, documentKey: unknown) {
  if (!isWorkflowDocumentKey(documentKey)) {
    throw new Error('未知的流程文件。')
  }

  const projectRoot = path.resolve(projectRootInput)
  const definition = WORKFLOW_DOCUMENTS[documentKey]
  const resolvedPath = path.resolve(projectRoot, definition.relativePath)
  const relativePath = path.relative(projectRoot, resolvedPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('流程文件不在项目根目录内。')
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`文件不存在：${definition.relativePath}`)
  }

  const stat = fs.statSync(resolvedPath)
  if (!stat.isFile()) {
    throw new Error(`目标不是文件：${definition.relativePath}`)
  }

  return {
    key: documentKey,
    title: definition.title,
    relativePath: definition.relativePath.replace(/\\/g, '/'),
    path: resolvedPath,
    updatedAt: stat.mtimeMs,
    content: fs.readFileSync(resolvedPath, 'utf-8'),
  }
}
