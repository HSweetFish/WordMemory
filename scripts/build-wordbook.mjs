/**
 * build-wordbook.mjs
 * 将 data/raw/ 的原始词库转换为应用种子数据 data/seed/。
 *
 * 转换逻辑：
 * 1. 规范化字段：w(单词) / uk(英音) / us(美音) / m(释义数组) / pos(词性) / ex(例句) / freq(COCA词频排名)
 * 2. 词性提取：从释义前缀启发式识别（n./v./adj./adv./prep. 等）
 * 3. 例句合并：用 4000 Essential English Words 的例句按单词匹配补充
 * 4. 词频标注：用 COCA 2万词频表的排名作为 freq（越小越常用）
 * 5. 输出：data/seed/<book>.json + data/seed/manifest.json
 *
 * 用法：node scripts/build-wordbook.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixEntry } from './pos-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, '../data/raw');
const SEED_DIR = path.resolve(__dirname, '../data/seed');

const BOOKS = [
  { id: 'cet4', name: '四级', desc: '大学英语四级词汇（约 2600 词）', file: 'cet4.json' },
  { id: 'cet6', name: '六级', desc: '大学英语六级词汇（约 2300 词）', file: 'cet6.json' },
  { id: 'kaoyan', name: '考研', desc: '考研英语词汇（约 3700 词）', file: 'kaoyan.json' },
  { id: 'ielts', name: '雅思', desc: '雅思核心词汇（约 3600 词）', file: 'ielts.json' },
  { id: 'toefl', name: '托福', desc: '托福核心词汇（约 4300 词）', file: 'toefl.json' },
  { id: 'coca2w', name: 'COCA 2万', desc: 'COCA 美语语料库两万高频词', file: 'coca2w.json' },
];

// 常见词性前缀（用于启发式提取）
const POS_PATTERNS = [
  /^(n\.|n\s)/, /^(v\.|v\s)/, /^(vt\.|vt\s)/, /^(vi\.|vi\s)/, /^(adj\.|adj\s)/,
  /^(adv\.|adv\s)/, /^(prep\.|prep\s)/, /^(conj\.|conj\s)/, /^(art\.|art\s)/,
  /^(pron\.|pron\s)/, /^(num\.|num\s)/, /^(int\.|int\s)/, /^(aux\.|aux\s)/,
  /^(abbr\.|abbr\s)/, /^(det\.|det\s)/, /^(modal\.|modal\s)/, /^(pref\.|pref\s)/,
  /^(suff\.|suff\s)/, /^(phr\.|phr\s)/, /^(pl\.|pl\s)/, /^(sing\.|sing\s)/,
];

const POS_MAP = {
  n: 'n.', v: 'v.', vt: 'vt.', vi: 'vi.', adj: 'adj.', adv: 'adv.', prep: 'prep.',
  conj: 'conj.', art: 'art.', pron: 'pron.', num: 'num.', int: 'int.', aux: 'aux.',
  abbr: 'abbr.', det: 'det.', modal: 'modal.', pref: 'pref.', suff: 'suff.',
  phr: 'phr.', pl: 'pl.', sing: 'sing.',
};

/** 释义文本中内嵌的词性标记（coca2w 风格：'v.行动,表现n.行为,行动'） */
const POS_TAG_RE = /(?:n|v|vt|vi|adj|adv|prep|conj|art|pron|num|int|aux|abbr|det|modal|pref|suff|phr|pl|sing)\./g;

function cleanEdge(s) {
  return String(s).replace(/^[\s,，、&]+|[\s,，、&]+$/g, '').trim();
}

/**
 * 把释义数组按内嵌词性标记拆分为 [{pos, text}]。
 * 有效条件：≥2 段，或仅 1 段且整段以词性标记开头（如 record 的 'n.记录,…'）。
 * 无内嵌标记时返回 null（调用方走回填/兜底）。
 */
function splitByPos(meanings) {
  const merged = meanings.join('；');
  const segs = [];
  let last = null;
  POS_TAG_RE.lastIndex = 0;
  let m;
  while ((m = POS_TAG_RE.exec(merged)) !== null) {
    if (last) {
      const text = cleanEdge(merged.slice(last.end, m.index));
      if (text) segs.push({ pos: last.tag, text });
    }
    last = { tag: m[0], end: m.index + m[0].length };
  }
  if (last) {
    const text = cleanEdge(merged.slice(last.end));
    if (text) segs.push({ pos: last.tag, text });
  }
  const valid = segs.length >= 2 || (segs.length === 1 && merged.trim().startsWith(segs[0].pos));
  return valid ? segs : null;
}

/** 把拆分结果转成「正确格式」：pos 列全部词性（；分隔去重），m 每段带词性前缀 */
function toStructured(segs) {
  const pos = [...new Set(segs.map((s) => s.pos))].join('；');
  const m = segs.map((s) => s.pos + s.text);
  return { pos, m };
}

function extractPos(meaning) {
  if (!meaning) return '';
  const first = String(meaning).trim();
  for (const re of POS_PATTERNS) {
    const m = first.match(re);
    if (m) {
      const key = m[1].replace(/[.\s]/g, '');
      return POS_MAP[key] || m[1].trim();
    }
  }
  return '';
}

function cleanPhone(p) {
  if (!p) return '';
  return String(p).trim().replace(/\s+/g, ' ');
}

/** 规范化单个原始词条 -> 种子词条
 * 词性/释义结构（「正确格式」）优先级：
 * 1. 释义内嵌词性标记（coca2w 风格）→ 按词性拆分：pos 列出全部词性，m 每段带词性前缀
 * 2. 无标记但 COCA 有结构化数据 → 回填 COCA 的 pos/m（考试词库顺带修正 bare 这类多词性词）
 * 3. 兜底：从释义前缀提取首个词性，m 原样保留
 */
function normalize(entry, freqMap, sentMap, cocaStructMap) {
  const word = String(entry.name || '').trim();
  if (!word) return null;
  const meanings = Array.isArray(entry.trans) ? entry.trans : [entry.trans].filter(Boolean);
  const cleanMeanings = meanings
    .map((m) => String(m).trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (cleanMeanings.length === 0) return null;

  let m = cleanMeanings;
  let pos = '';
  const segs = splitByPos(cleanMeanings);
  if (segs) {
    ({ pos, m } = toStructured(segs));
  } else {
    const coca = cocaStructMap.get(word.toLowerCase());
    if (coca) {
      ({ pos, m } = coca);
    } else {
      pos = extractPos(cleanMeanings[0]) || '';
    }
  }
  // 例句匹配（按小写单词）
  const ex = sentMap.get(word.toLowerCase()) || [];

  const out = {
    w: word,
    uk: cleanPhone(entry.ukphone),
    us: cleanPhone(entry.usphone),
    m,
    pos,
    ex,
    freq: freqMap.has(word.toLowerCase()) ? freqMap.get(word.toLowerCase()) : null,
  };
  // 词性兜底修复：尾部 "(vt.)" 标记 / 手动映射表 / 后缀规则（scripts/pos-lib.mjs）
  // 原始词库释义本身无词性标注时（如 harbour、pint），这里补上词性前缀
  const prefixed = out.m.every((x) => /^[a-zA-Z]+\./.test(String(x).trim()));
  if (!(prefixed && out.pos)) {
    fixEntry(out);
  }
  // 过滤编码损坏的乱码词条（如 "saut�<U+FFFD>�"）
  if (/锟|�|�/.test(String(word))) return null;

  return out;
}

await mkdir(SEED_DIR, { recursive: true });

// ---- 1. 构建 COCA 词频表（word -> 排名）----
const cocaRaw = JSON.parse(await readFile(path.join(RAW_DIR, 'coca2w.json'), 'utf-8'));
const freqMap = new Map();
cocaRaw.forEach((entry, idx) => {
  const w = String(entry.name || '').trim().toLowerCase();
  if (w) freqMap.set(w, idx + 1);
});
console.log(`COCA 词频表: ${freqMap.size} 词`);

// ---- 1.5 构建 COCA 结构化词性表（word -> {pos, m}）----
// COCA 词库释义自带词性前缀（如 "v.行动n.行为"），可回填其他词库缺失的词性标注，
// 并顺带修正多词性词（bare = adj./v. 之类）的释义归属。
const cocaStructMap = new Map();
let cocaStructured = 0;
for (const entry of cocaRaw) {
  const w = String(entry.name || '').trim().toLowerCase();
  if (!w) continue;
  const trans = Array.isArray(entry.trans) ? entry.trans : [entry.trans];
  const meanings = trans.map((t) => String(t).trim()).filter(Boolean);
  if (meanings.length === 0) continue;
  const segs = splitByPos(meanings);
  if (segs) {
    cocaStructMap.set(w, toStructured(segs));
    cocaStructured++;
  } else {
    const pos = extractPos(meanings[0]);
    if (pos) cocaStructMap.set(w, { pos, m: meanings });
  }
}
console.log(`COCA 结构化词性表: ${cocaStructMap.size} 词（多词性拆分 ${cocaStructured} 词）`);

// ---- 2. 构建例句表（word -> [sentence]）----
const sentRaw = JSON.parse(await readFile(path.join(RAW_DIR, 'sentences4000.json'), 'utf-8'));
const sentMap = new Map();
for (const entry of sentRaw) {
  const w = String(entry.name || '').trim().toLowerCase();
  if (!w) continue;
  const sentences = (Array.isArray(entry.trans) ? entry.trans : [entry.trans])
    .map((s) => String(s).trim())
    .filter((s) => s && /[A-Za-z]/.test(s));
  if (sentences.length) sentMap.set(w, sentences);
}
console.log(`例句表: ${sentMap.size} 词`);

// ---- 3. 逐词库转换 ----
const manifest = [];
let totalWords = 0;
let withPos = 0;
let withEx = 0;
let withFreq = 0;
let multiPos = 0;

for (const book of BOOKS) {
  const raw = JSON.parse(await readFile(path.join(RAW_DIR, book.file), 'utf-8'));
  const seen = new Set();
  const words = [];
  for (const entry of raw) {
    const norm = normalize(entry, freqMap, sentMap, cocaStructMap);
    if (!norm) continue;
    const key = norm.w.toLowerCase();
    if (seen.has(key)) continue; // 词库内去重（忽略大小写）
    seen.add(key);
    words.push(norm);
    totalWords++;
    if (norm.pos) withPos++;
    if (norm.ex.length) withEx++;
    if (norm.freq != null) withFreq++;
    if ((norm.pos.match(/[nvtai]\./g) || []).length >= 2) multiPos++;
  }
  const out = { id: book.id, name: book.name, desc: book.desc, words };
  await writeFile(path.join(SEED_DIR, `${book.id}.json`), JSON.stringify(out), 'utf-8');
  manifest.push({ id: book.id, name: book.name, desc: book.desc, count: words.length, file: `${book.id}.json` });
  console.log(`✔ ${book.id} (${book.name}): ${words.length} 词`);
}

await writeFile(path.join(SEED_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

console.log('\n===== 汇总 =====');
console.log(`总词条（含跨词库重复）: ${totalWords}`);
console.log(`带词性: ${withPos} (${((withPos / totalWords) * 100).toFixed(0)}%)`);
console.log(`多词性词条: ${multiPos}`);
console.log(`带例句: ${withEx} (${((withEx / totalWords) * 100).toFixed(0)}%)`);
console.log(`带词频: ${withFreq} (${((withFreq / totalWords) * 100).toFixed(0)}%)`);
console.log('\n种子数据已写入 data/seed/');
