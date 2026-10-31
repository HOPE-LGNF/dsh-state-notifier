import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALLOWED_EXECUTABLES, probe, resolveExecutable } from '../src/native.js';

// 探测结果只依赖文件系统与环境，测试用构造值，避免依赖运行机器是否为 WSL。
const detected = (overrides = {}) => ({
  platform: 'linux', wsl: true, available: true,
  candidates: ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'], reason: '',
  ...overrides,
});

test('探测结果结构稳定：只读、不执行、给出原因', () => {
  const result = probe();
  assert.equal(typeof result.available, 'boolean');
  assert.equal(typeof result.wsl, 'boolean');
  assert.equal(typeof result.platform, 'string');
  assert.equal(Array.isArray(result.candidates), true);
  assert.equal(typeof result.reason, 'string');
  if (!result.available) assert.equal(result.reason.length > 0, true, '不可用必须给出原因');
});

test('auto 模式使用探测到的第一个候选，不可用时明确拒绝', () => {
  const ok = resolveExecutable('auto', '', detected());
  assert.equal(ok.ok, true);
  assert.equal(ok.path, detected().candidates[0]);

  const missing = resolveExecutable('auto', '', detected({ available: false, candidates: [], reason: '未找到' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, '未找到');
});

test('manual 模式拒绝相对路径、非白名单文件名与不存在的路径', async () => {
  assert.equal(resolveExecutable('manual', 'powershell.exe', detected()).ok, false, '相对路径必须拒绝');
  assert.equal(resolveExecutable('manual', '/usr/bin/bash', detected()).ok, false, '非白名单必须拒绝');
  assert.equal(resolveExecutable('manual', '/tmp/not-there/powershell.exe', detected()).ok, false, '不存在的路径必须拒绝');
  assert.equal(resolveExecutable('manual', '', detected()).ok, false);
  assert.equal(resolveExecutable('manual', null, detected()).ok, false);
});

test('manual 模式接受白名单内的绝对路径（大小写不敏感）', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-probe-'));
  try {
    for (const name of ['powershell.exe', 'pwsh.exe']) {
      const file = join(directory, name);
      await writeFile(file, '');
      const resolved = resolveExecutable('manual', file, detected());
      assert.equal(resolved.ok, true, `${name} 应被接受`);
      assert.equal(resolved.path, file);
    }
    const upper = join(directory, 'PowerShell.EXE');
    await writeFile(upper, '');
    assert.equal(resolveExecutable('manual', upper, detected()).ok, true, '文件名大小写不敏感');
    const wrong = join(directory, 'bash');
    await writeFile(wrong, '');
    await chmod(wrong, 0o755);
    assert.equal(resolveExecutable('manual', wrong, detected()).ok, false, '非白名单即使可执行也拒绝');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('白名单只有两个解释器，cmd.exe 不在其中', () => {
  assert.deepEqual([...ALLOWED_EXECUTABLES], ['powershell.exe', 'pwsh.exe']);
  assert.equal(ALLOWED_EXECUTABLES.includes('cmd.exe'), false, 'cmd 无法直接创建 toast');
});

test('候选去重、路径规范，且系统 PowerShell 5.1 优先于 pwsh', () => {
  const result = probe();
  const lowered = result.candidates.map(path => path.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length, '候选不得重复（Windows 路径大小写不敏感）');
  assert.equal(result.candidates.every(path => !path.includes('//')), true, '路径不得出现重复斜杠');
  if (lowered.some(path => path.endsWith('powershell.exe'))) {
    assert.equal(lowered[0].endsWith('powershell.exe'), true, 'PowerShell 7 缺少 WinRT 投影，必须让 5.1 优先');
  }
});
