/**
 * fix-pos.mjs —— 补齐 seed 词库中缺失词性的词条（pos 为空 / 释义无词性前缀）
 *
 * 修复策略（按优先级）：
 *  1. fixEntry：尾部 "(vt.)" 标记提取 → 手动映射表 → 后缀规则推断
 *  2. 交叉回填：其他词库中同词已有结构化词性 → 直接复用
 *  3. 剩余无法判断的词条保持原样（不瞎猜）
 *
 * 用法：node scripts/fix-pos.mjs
 * 效果：data/seed/*.json 与 public/dicts/*.json 同步更新
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixEntry } from './pos-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '../data/seed');
const PUB_DIR = path.resolve(__dirname, '../public/dicts');

const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json');

// ---- 1. 构建交叉回填索引：word(lower) -> { pos, m }（已有词性的词条优先保留结构化信息）----
const index = new Map();
for (const f of files) {
  const data = JSON.parse(readFileSync(path.join(SEED_DIR, f), 'utf8'));
  const arr = Array.isArray(data) ? data : data.words || [];
  for (const w of arr) {
    if (!w || !w.w || !Array.isArray(w.m) || !w.m.length) continue;
    const key = String(w.w).toLowerCase();
    const prefixed = w.m.every((x) => /^[a-zA-Z]+\./.test(String(x).trim()));
    if (w.pos && prefixed) {
      if (!index.has(key)) index.set(key, { pos: w.pos, m: w.m });
    }
  }
}
console.log(`cross-fill index: ${index.size} words with known pos`);

// ---- 2. 逐词库修复 ----
let fixed = 0;
let remaining = 0;
const remainingWords = [];

for (const f of files) {
  const filePath = path.join(SEED_DIR, f);
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const arr = Array.isArray(data) ? data : data.words || [];
  let fileFixed = 0;
  let fileRemain = 0;

  for (const w of arr) {
    if (!w || !Array.isArray(w.m) || !w.m.length) continue;
    const prefixed = w.m.every((x) => /^[a-zA-Z]+\./.test(String(x).trim()));
    if (prefixed && w.pos) continue;

    const key = String(w.w).toLowerCase();
    let ok = false;

    // 2a. 规则修复（尾部标记 / 映射表 / 后缀）
    if (fixEntry(w)) ok = true;

    // 2b. 交叉回填
    if (!ok && index.has(key)) {
      const src = index.get(key);
      // 段数一致 → 直接复用结构；不一致 → 按源词性列表对齐当前释义
      if (src.m.length === w.m.length) {
        w.pos = src.pos;
        w.m = src.m.map((s) => s);
        ok = true;
      } else {
        const posList = src.pos.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
        if (posList.length) {
          const m = w.m;
          if (m.length <= 1) {
            w.pos = [...new Set(posList)].join('；');
            w.m = [posList[0] + (m[0] || '')];
          } else {
            w.pos = [...new Set(posList)].join('；');
            w.m = m.map((x, i) => (posList[i % posList.length] ?? posList[0]) + x);
          }
          ok = true;
        }
      }
    }

    if (ok) {
      fixed++;
      fileFixed++;
    } else {
      remaining++;
      fileRemain++;
      remainingWords.push({ file: f, w: w.w });
    }
  }

  writeFileSync(filePath, JSON.stringify(data), 'utf8');
  console.log(`[${f}] fixed ${fileFixed}, still missing ${fileRemain}`);
}

// ---- 3. 同步 public/dicts ----
mkdirSync(PUB_DIR, { recursive: true });
for (const f of files) {
  copyFileSync(path.join(SEED_DIR, f), path.join(PUB_DIR, f));
}
console.log('public/dicts synced');

console.log(`\nTOTAL fixed: ${fixed}, still missing: ${remaining}`);
if (remainingWords.length) {
  console.log('still-missing words:');
  const byFile = new Map();
  for (const r of remainingWords) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r.w);
  }
  for (const [f, ws] of byFile) {
    console.log(`  ${f}: ${ws.join(', ')}`);
  }
}
