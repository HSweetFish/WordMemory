/**
 * generate-sw.mjs
 * 构建后生成 dist/sw.js：扫描 dist 产物，把应用外壳资产清单注入 SW 的 precache。
 *
 * 背景：旧方案 install 阶段只 precache index.html，JS/CSS 靠第二次在线访问才入缓存，
 * 导致「首次访问后立即离线」白屏。现在构建时静态生成完整清单，首次访问即可全量离线。
 *
 * 用法：node scripts/generate-sw.mjs（vite build 之后运行）
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');

/** 递归收集 dist 下所有文件（相对 URL，以 ./ 开头，排除 sw.js 自身） */
async function listFiles(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(base, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(full, rel)));
    } else if (entry.name !== 'sw.js') {
      out.push('./' + rel);
    }
  }
  return out;
}

const files = await listFiles(DIST);
const template = await readFile(path.resolve(__dirname, 'sw-template.js'), 'utf-8');
const sw = template.replace('__PRECACHE__', JSON.stringify(files, null, 2));
await writeFile(path.join(DIST, 'sw.js'), sw, 'utf-8');
console.log(`✔ dist/sw.js 已生成：precache ${files.length} 个应用外壳文件`);
