/**
 * download-wordlists.mjs
 * 从 qwerty-learner 开源仓库下载词库原始数据（单词/释义/美音音标/英音音标）。
 * 数据来源：https://github.com/RealKai42/qwerty-learner （GPL-3.0，仅取词库数据，不复制代码）
 *
 * 用法：node scripts/download-wordlists.mjs
 * 输出：data/raw/<book>.json
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, '../data/raw');
const BASE = 'https://raw.githubusercontent.com/RealKai42/qwerty-learner/master/public/dicts';

// 词库清单：id -> 远程文件名（候选列表，按顺序尝试）
const BOOKS = [
  { id: 'cet4', name: '四级', files: ['CET4_T.json', 'CET4_1_T.json'] },
  { id: 'cet6', name: '六级', files: ['CET6_T.json', 'CET6_1_T.json'] },
  { id: 'kaoyan', name: '考研', files: ['KaoYan_3_T.json', 'KaoYan_1_T.json', 'KaoYan_2_T.json'] },
  { id: 'ielts', name: '雅思', files: ['IELTS_T.json', 'IELTS_3_T.json'] },
  { id: 'toefl', name: '托福', files: ['TOEFL_T.json', 'TOEFL_3_T.json'] },
  { id: 'coca2w', name: 'COCA 2万词频', files: ['coca20000.json'] },
];

// 例句补充源（4000 Essential English Words，含英文例句）
const SENTENCES = [
  { id: 'sentences4000', files: ['4000_Essential_English_Words-sentence.json'] },
];

async function download(url, dest, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('{')) {
        // 内容异常时继续重试
      }
      await writeFile(dest, text, 'utf-8');
      return text.length;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`重试耗尽 ${url}`);
}

await mkdir(RAW_DIR, { recursive: true });

for (const book of BOOKS) {
  const dest = path.join(RAW_DIR, `${book.id}.json`);
  try {
    await access(dest);
    console.log(`• ${book.id} (${book.name}) 已存在，跳过`);
    continue;
  } catch { /* 不存在则下载 */ }
  let ok = false;
  for (const file of book.files) {
    const url = `${BASE}/${file}`;
    try {
      const bytes = await download(url, dest);
      console.log(`✔ ${book.id} (${book.name}) <- ${file} (${(bytes / 1024).toFixed(0)} KB)`);
      ok = true;
      break;
    } catch {
      // 尝试下一个候选文件名
    }
  }
  if (!ok) console.warn(`✘ ${book.id} (${book.name}) 未找到可用词库文件`);
}

console.log('--- 例句源 ---');
for (const src of SENTENCES) {
  const dest = path.join(RAW_DIR, `${src.id}.json`);
  try {
    await access(dest);
    console.log(`• ${src.id} 已存在，跳过`);
    continue;
  } catch { /* 不存在则下载 */ }
  for (const file of src.files) {
    const url = `${BASE}/${file}`;
    try {
      const bytes = await download(url, dest);
      console.log(`✔ ${src.id} <- ${file} (${(bytes / 1024).toFixed(0)} KB)`);
      break;
    } catch {
      console.warn(`✘ ${src.id} <- ${file} 下载失败`);
    }
  }
}

console.log('\n完成。原始数据位于 data/raw/');
