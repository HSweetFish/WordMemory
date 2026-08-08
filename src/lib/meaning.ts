import type { Word } from '@/types';
import { parsePos } from '@/lib/pos';

/** 按词性分组后的展示单元：一行 = 词性 + 该词性下的释义 */
export interface MeaningLine {
  pos: string;
  meaning: string;
}

/** 释义文本中可能内嵌的词性标记（coca2w 等词库格式：'v.行动,表现n.行为,行动'） */
const POS_TAG_RE = /(?:n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|aux|modal|abbr|phr|comb|pref|suf)\./g;

function cleanEdge(s: string): string {
  return s.replace(/^[\s,，、&]+|[\s,，、&]+$/g, '').trim();
}

/** 释义分段分隔符（中文分号/逗号/顿号等） */
const SEG_RE = /[；;，,、]+/;

/**
 * 多词性 + 无内嵌标记（自定义导入书常见格式，如 pos='n. v.'，m=['奖','奖品','授予']）：
 * 释义段按「词性顺序 = 词典义项顺序」的惯例，按比例分给各词性。
 * 段数 ≥ 词性数时逐词性分列；段数不足时无法归属，退回合并显示。
 */
function groupByPos(poss: string[], merged: string): MeaningLine[] {
  const segments = merged.split(SEG_RE).map((s) => s.trim()).filter(Boolean);
  const n = poss.length;
  if (segments.length < n) {
    return [{ pos: poss.join('/'), meaning: merged }];
  }
  const lines: MeaningLine[] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const end = i === n - 1 ? segments.length : Math.round(((i + 1) * segments.length) / n);
    const part = segments.slice(start, end);
    if (part.length) lines.push({ pos: poss[i], meaning: part.join('；') });
    start = end;
  }
  return lines;
}

/**
 * 把 Word 的释义按词性分组，供翻转背面 / 四选一选项 / 拼写题目共用。
 *
 * 数据有三种形态：
 * 1. 干净型（cet4）：pos='n.'，m=['活动； 活力； 行动'] → 一行：'n. 活动； 活力； 行动'
 * 2. 混排型（coca2w）：pos='v.'，m=['v.行动,表现n.行为,行动'] → 两行：'v. 行动,表现' / 'n. 行为,行动'
 * 3. 多词性无标记（自定义导入书）：pos='n. v.'，m=['奖','奖品','授予'] → 按义项顺序比例分列
 */
export function meaningLines(word: Pick<Word, 'pos' | 'm'>): MeaningLine[] {
  const merged = word.m.join('；');
  const groups: MeaningLine[] = [];
  let last: { pos: string; end: number } | null = null;
  POS_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = POS_TAG_RE.exec(merged)) !== null) {
    const tag = m[0];
    if (last) {
      const meaning = cleanEdge(merged.slice(last.end, m.index));
      if (meaning) groups.push({ pos: last.pos, meaning });
    }
    last = { pos: tag, end: m.index + tag.length };
  }
  if (last) {
    const meaning = cleanEdge(merged.slice(last.end));
    if (meaning) groups.push({ pos: last.pos, meaning });
  }
  // 内嵌词性分组有效：≥2 组，或仅 1 组且文本以词性标记开头（如 record: 'n.记录,…'）
  const hasEmbedded = groups.length >= 2 || (groups.length === 1 && merged.trim().startsWith(groups[0].pos));
  if (hasEmbedded) return groups;
  // 兜底：多词性按比例分列；单词性/无词性合并显示
  const poss = parsePos(word.pos);
  if (poss.length >= 2) return groupByPos(poss, merged);
  return [{ pos: poss.length ? poss.join('/') : '词', meaning: merged }];
}
