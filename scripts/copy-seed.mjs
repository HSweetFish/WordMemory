/**
 * copy-seed.mjs
 * 将 data/seed/ 生成的词库种子数据拷贝到 public/dicts/，供应用按需加载。
 * 用法：node scripts/copy-seed.mjs
 */

import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../data/seed');
const DEST = path.resolve(__dirname, '../public/dicts');

await mkdir(DEST, { recursive: true });
const files = (await readdir(SRC)).filter((f) => f.endsWith('.json'));
for (const f of files) {
  await cp(path.join(SRC, f), path.join(DEST, f));
  console.log(`✔ ${f}`);
}
console.log(`\n共 ${files.length} 个文件已拷贝到 public/dicts/`);
