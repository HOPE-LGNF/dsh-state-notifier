import { spawnSync } from 'node:child_process';

/** 实测当前 Node 接受的隔离参数，不依赖帮助文本的格式。 */
export function testIsolationArgs(spawn = spawnSync) {
  for (const flag of ['--test-isolation=none', '--experimental-test-isolation=none']) {
    const result = spawn(process.execPath, [flag, '--version'], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status === null) throw new Error('无法探测 Node 测试参数');
    if (result.status === 0) return [flag];
  }
  return [];
}
