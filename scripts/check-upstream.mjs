import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { testIsolationArgs } from './test-options.mjs';

// 只替换被插件消费的 Session 实现。它不代表完整 master 应用验收。
const upstream = process.argv[2];
if (!upstream) throw new Error('用法：node scripts/check-upstream.mjs /path/to/deepseek-harness');
const entry = resolve(upstream, 'packages/core/session/src/index.ts');
const version = JSON.parse(await readFile(resolve(upstream, 'packages/core/session/package.json'), 'utf8')).version;
const directory = await mkdtemp(resolve('.upstream-check-'));
try {
  const output = join(directory, 'session.mjs');
  await build({ entryPoints: [entry], outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });
  const result = spawnSync(process.execPath, ['--test', ...testIsolationArgs(), 'test/integration.test.js'], {
    env: { ...process.env, DSH_SESSION_SOURCE: output }, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('上游 Session 集成检查失败');
  console.log(`已检查上游 Session ${version}；外部依赖仍使用本项目锁文件。`);
} finally { await rm(directory, { recursive: true, force: true }); }
