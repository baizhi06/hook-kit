#!/usr/bin/env node
/**
 * verify.mjs —— 自检：跑测试 + 打印登记表 + 可选重写 docs/HOOKS.md
 *
 *   node verify.mjs              跑测试并打印登记表
 *   node verify.mjs --write-doc  同时把登记表写进 docs/HOOKS.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderHooksDoc } from './src/index.mjs';
import { buildKit } from './examples/wire-into-bridge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const writeDoc = process.argv.includes('--write-doc');

console.log('① 语法检查');
for (const file of ['src/index.mjs', 'examples/wire-into-bridge.mjs', 'verify.mjs']) {
  execFileSync(process.execPath, ['--check', path.join(here, file)], { windowsHide: true, stdio: 'pipe' });
  console.log(`   OK  ${file}`);
}

console.log('\n② 单元测试');
const testFiles = fs.readdirSync(path.join(here, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join('test', f));
for (const file of testFiles) {
  execFileSync(process.execPath, ['--test', path.join(here, file)], { windowsHide: true, stdio: 'inherit' });
}

console.log('\n③ 登记表（示例接线）');
const kit = buildKit();
const doc = renderHooksDoc(kit, { intro: '> 这张表由 `node verify.mjs --write-doc` 生成。' });
console.log(kit.describe({ format: 'md' }));

if (writeDoc) {
  const target = path.join(here, 'docs', 'HOOKS.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, doc + '\n', 'utf8');
  console.log(`\n已写入 ${path.relative(here, target)}`);
} else {
  console.log('\n（加 --write-doc 可重写 docs/HOOKS.md）');
}
