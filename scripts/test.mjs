// 测试入口：实测隔离参数。Node 不支持时使用默认隔离。
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { testIsolationArgs } from './test-options.mjs';

const isolation = testIsolationArgs();
const directory = fileURLToPath(new URL('../test/', import.meta.url));
// 显式列出文件：Windows 的 cmd 不展开 glob，交给 Node 解析也会因版本而异。
const files = readdirSync(directory).filter(name => name.endsWith('.test.js')).sort()
  .map(name => fileURLToPath(new URL(`../test/${name}`, import.meta.url)));

const result = spawnSync(process.execPath, ['--test', ...isolation, ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
