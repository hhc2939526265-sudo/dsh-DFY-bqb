// 自检入口：① 全量 node --check 语法检查 ② 运行 node:test 全部用例。
// 用法：node selfcheck.mjs [--syntax|--test]；默认两项都跑，任一失败则退出码 1。
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const onlySyntax = args.includes('--syntax');
const onlyTest = args.includes('--test');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (['.js', '.mjs'].includes(extname(p))) out.push(p);
  }
  return out;
}

function section(title) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}

let failures = 0;

// ① 语法检查
if (!onlyTest) {
  section('语法检查 node --check');
  const files = walk(root);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status === 0) {
      // eslint-disable-next-line no-console
      console.log(`PASS  ${f.replace(root, '')}`);
    } else {
      failures += 1;
      // eslint-disable-next-line no-console
      console.log(`FAIL  ${f.replace(root, '')}\n${r.stderr}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`语法检查：${files.length} 个文件`);
}

// ② 测试
if (!onlySyntax) {
  section('单元/集成测试 node --test');
  const testsDir = join(root, 'tests');
  const testFiles = readdirSync(testsDir)
    .filter((n) => n.endsWith('.test.mjs'))
    .map((n) => join(testsDir, n));
  const r = spawnSync(process.execPath, ['--test', ...testFiles], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (r.status !== 0) failures += 1;
}

section('自检汇总');
if (failures === 0) {
  // eslint-disable-next-line no-console
  console.log('全部通过 ✓');
  process.exit(0);
} else {
  // eslint-disable-next-line no-console
  console.log(`存在 ${failures} 项失败 ✗`);
  process.exit(1);
}
