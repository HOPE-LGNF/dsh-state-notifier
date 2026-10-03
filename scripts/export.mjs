import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(result.stderr || 'Git 操作失败');
  return result.stdout.trim();
}
if (git(['status', '--porcelain'])) throw new Error('请先提交已检查的改动，再导出。');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const directory = resolve('artifacts');
await mkdir(directory, { recursive: true });
const filename = `${pkg.name}-${pkg.version}.bundle`;
const bundle = join(directory, filename);
git(['bundle', 'create', bundle, '--all']);
git(['bundle', 'verify', bundle]);
const temporary = await mkdtemp(join(tmpdir(), 'state-notifier-restore-'));
try {
  const restored = join(temporary, 'repo');
  // 不让临时 GIT_DIR/GIT_WORK_TREE 污染恢复检查。
  const env = { ...process.env };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  git(['clone', bundle, restored], { env });
  if (git(['rev-parse', 'HEAD']) !== git(['-C', restored, 'rev-parse', 'HEAD'], { env })) throw new Error('恢复后的提交不一致');
  const hash = createHash('sha256').update(await readFile(bundle)).digest('hex');
  await writeFile(join(directory, `${filename}.sha256`), `${hash}  ${filename}\n`);
  console.log(`已生成并恢复验证：artifacts/${filename}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
