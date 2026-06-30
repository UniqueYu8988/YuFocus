import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const distillerSource = fs.readFileSync(path.join(repoRoot, 'src', 'distiller.py'), 'utf-8')
const labSource = fs.readFileSync(path.join(repoRoot, 'desktop', 'scripts', 'generate_mimo_cleaning_prompt_lab.py'), 'utf-8')

const productionFunctionMatch = distillerSource.match(/def _clean_one_chunk_with_checkpoint[\s\S]*?\ndef _prune_stale_cleaning_chunks/u)
assert.ok(productionFunctionMatch, '必须能定位正式清洗函数 _clean_one_chunk_with_checkpoint。')

const productionFunction = productionFunctionMatch[0]

assert.doesNotMatch(
  productionFunction,
  /cleaning_profile\s*=/u,
  '正式生产清洗路径不得向 _request_mimo_cleaning 传入 UP cleaning_profile。',
)

assert.match(
  distillerSource,
  /清洗策略：通用高保真逐字清洗。不使用 UP 专属压缩或改写策略。/u,
  '无 profile 的正式清洗 prompt 必须明确使用通用高保真逐字清洗。',
)

assert.match(
  distillerSource,
  /实验性 UP 清洗策略仅供参考/u,
  'UP profile 只能作为实验性清洗策略存在，不能成为生产默认路线。',
)

assert.match(
  labSource,
  /LAB_ROOT\s*=\s*REPO_ROOT\s*\/\s*"data"\s*\/\s*"temp"\s*\/\s*"mimo-cleaning-prompt-lab"/u,
  'MiMo UP prompt lab 必须只写 data/temp/mimo-cleaning-prompt-lab。',
)

assert.match(
  labSource,
  /cleaning_profile=profile/u,
  'UP profile 的真实调用只能保留在 prompt lab 实验脚本中。',
)

console.log('mimo cleaning production mode check passed')
