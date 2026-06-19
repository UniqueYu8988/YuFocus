import fs from 'node:fs'
import path from 'node:path'

const WORKFLOW_DOCUMENTS = {
  agents: {
    title: 'AI 工作入口',
    relativePath: 'AGENTS.md',
  },
  product: {
    title: '产品边界',
    relativePath: 'PRODUCT.md',
  },
  architecture: {
    title: '技术结构',
    relativePath: 'ARCHITECTURE.md',
  },
  current_state: {
    title: '当前状态',
    relativePath: 'CURRENT_STATE.md',
  },
  baseline_acceptance: {
    title: '核心验收',
    relativePath: path.join('docs', 'BASELINE_ACCEPTANCE.md'),
  },
  stabilization_plan: {
    title: '稳定化计划',
    relativePath: path.join('docs', 'plans', 'STABILIZATION_PLAN.md'),
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
