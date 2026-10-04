import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testIsolationArgs } from '../scripts/test-options.mjs';

test('隔离参数按实际支持情况选择，不依赖帮助文本', () => {
  for (const supported of ['--test-isolation=none', '--experimental-test-isolation=none', null]) {
    const calls = [];
    const args = testIsolationArgs((executable, argv) => {
      assert.equal(executable, process.execPath);
      assert.equal(argv[1], '--version');
      calls.push(argv[0]);
      return { status: argv[0] === supported ? 0 : 9 };
    });
    assert.deepEqual(args, supported ? [supported] : []);
    assert.deepEqual(calls, supported === '--test-isolation=none'
      ? ['--test-isolation=none'] : ['--test-isolation=none', '--experimental-test-isolation=none']);
  }
});

test('参数探测的启动失败或信号中止不得降级为成功', () => {
  const error = new Error('fixture spawn failure');
  assert.throws(() => testIsolationArgs(() => ({ error })), value => value === error);
  assert.throws(() => testIsolationArgs(() => ({ status: null, signal: 'SIGTERM' })), /无法探测/);
});

test('选出的隔离参数可由当前 Node 实际执行', () => {
  const args = testIsolationArgs();
  const result = spawnSync(process.execPath, [...args, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), process.version);
});

test('上游 Session 检查失败返回非零，并清理临时构建目录', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-upstream-fixture-'));
  const pending = async () => (await readdir(root)).filter(name => name.startsWith('.upstream-check-')).sort();
  const before = await pending();
  try {
    const session = join(temporary, 'packages/core/session');
    await mkdir(join(session, 'src'), { recursive: true });
    await writeFile(join(session, 'package.json'), JSON.stringify({ version: '0.0.0-fixture' }));
    // 缺少官方 Session 接口，必须使集成检查失败。
    await writeFile(join(session, 'src/index.ts'), 'export const fixture = true;\n');
    const result = spawnSync(process.execPath, ['scripts/check-upstream.mjs', temporary], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /上游 Session 集成检查失败/);
    assert.deepEqual(await pending(), before);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
