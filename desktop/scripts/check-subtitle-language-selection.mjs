import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const pythonCode = String.raw`
import pathlib
import sys

repo_root = pathlib.Path(r"${repoRoot}")
sys.path.insert(0, str(repo_root / "src"))

from bilibili_api import _select_preferred_subtitles


def selected_lans(subtitles):
    return [item.get("lan") for item in _select_preferred_subtitles(subtitles)]


zh = {"lan": "ai-zh", "lang": "中文", "entries": [{"content": "中文正文"}]}
en = {"lan": "ai-en", "lang": "English", "entries": [{"content": "English body"}]}
ja = {"lan": "ja", "lang": "日本語", "entries": [{"content": "日本語"}]}

assert selected_lans([zh, en]) == ["ai-zh"], "中文和英文同时存在时，正文只能选择中文轨"
assert selected_lans([en, zh]) == ["ai-zh"], "即使英文排在前面，也应优先选择中文轨"
assert selected_lans([en, ja]) == ["ai-en"], "没有中文时，应使用英文兜底"
assert selected_lans([ja]) == ["ja"], "没有中文或英文时，应使用第一条可用字幕"
assert selected_lans([]) == [], "没有字幕时应返回空列表"

print("subtitle language selection check passed")
`;

const result = spawnSync(process.env.PYTHON || 'python', ['-c', pythonCode], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (result.stdout.trim()) {
  console.log(result.stdout.trim());
}
if (result.stderr.trim()) {
  console.error(result.stderr.trim());
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
