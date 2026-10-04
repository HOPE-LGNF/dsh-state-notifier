// 测试入口：Node 24 把该选项改名为 --test-isolation=none，Node 22 仍是
// --experimental-test-isolation=none。这里按当前 Node 实际支持的拼写选择，
// 两者都没有时退回默认的文件级隔离，使 CI 的每个 Node 版本都能运行。
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' }).stdout ?? '';
const isolation = ['--test-isolation=none', '--experimental-test-isolation=none'].find(flag => help.includes(flag));
const directory = fileURLToPath(new URL('../test/', import.meta.url));
// 显式列出文件：Windows 的 cmd 不展开 glob，交给 Node 解析也会因版本而异。
const files = readdirSync(directory).filter(name => name.endsWith('.test.js')).sort()
  .map(name => fileURLToPath(new URL(`../test/${name}`, import.meta.url)));

const result = spawnSync(process.execPath, ['--test', ...(isolation ? [isolation] : []), ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
