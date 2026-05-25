import path from 'node:path'
import { validateMaterialPackageAtPath } from './materialValidation.ts'

function printUsage() {
  console.error('Usage: npm run validate:material -- <path-to-.course_material>')
}

const materialArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'))

if (!materialArg) {
  printUsage()
  process.exit(2)
}

const materialPath = path.resolve(materialArg)
const report = validateMaterialPackageAtPath(materialPath)
const compact = {
  material_path: report.material_path,
  stage: report.stage,
  semantic_status: report.semantic_status,
  validation_status: report.validation_status,
  contract_version: report.contract_version,
  contract_mode: report.contract_mode,
  profile: report.profile,
  pipeline_ready: report.pipeline_ready,
  legacy_validation_passed: report.legacy_validation_passed,
  upgrade_required_for_pipeline_ready: report.upgrade_required_for_pipeline_ready,
  audit_ready: report.audit_ready,
  release_ready: report.release_ready,
  repair_intent: report.repair_intent,
  error_count: report.summary.error_count,
  warning_count: report.summary.warning_count,
  issue_codes: report.issues.map((issue) => issue.code),
  validation_report: 'content_draft/review_exports/validation_report.json',
}

console.log(JSON.stringify(compact, null, 2))
process.exit(report.pipeline_ready ? 0 : 1)
