import { db } from '@/db/schema';
import { getLearnedCache, setLearnedCache } from '@/services/learned-cache';
import { classifyMastery } from '@/lib/mastery';
import { scheduleSync } from '@/services/localfile';
import type { BookMeta, UserWord, Word } from '@/types';

/**
 * 词库服务：词库元信息、安装/卸载、自定义导入、单词查询
 */

const DICTS_BASE = import.meta.env.BASE_URL + 'dicts/';

/** 获取词库清单（public/dicts/manifest.json） */
export async function fetchManifest(): Promise<BookMeta[]> {
  const res = await fetch(`${DICTS_BASE}manifest.json`);
  if (!res.ok) throw new Error('词库清单加载失败');
  return res.json();
}

/** 拉取某个词库的完整数据 */
export async function fetchBookData(bookId: string): Promise<{ id: string; name: string; words: Word[] }> {
  const res = await fetch(`${DICTS_BASE}${bookId}.json`);
  if (!res.ok) throw new Error(`词库 ${bookId} 加载失败`);
  const data = await res.json();
  return data;
}

/** 词库是否已安装（words 表中有该词库的词条） */
export async function isBookInstalled(bookId: string): Promise<boolean> {
  const count = await db.words.where('books').equals(bookId).count();
  return count > 0;
}

/** 安装词库：拉取并写入 words 表（幂等，重复安装会合并更新） */
export async function installBook(bookId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  if (await isBookInstalled(bookId)) return 0;
  const data = await fetchBookData(bookId);
  return installBookData(bookId, data.words, onProgress);
}

/** 将词库数据写入 words 表（与网络解耦，便于测试与复用） */
export async function installBookData(
  bookId: string,
  words: Word[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const total = words.length;
  // 分批写入，避免一次性事务过大
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < total; i += BATCH) {
    const chunk = words.slice(i, i + BATCH);
    await db.transaction('rw', db.words, async () => {
      for (const w of chunk) {
        const key = w.w.toLowerCase();
        const existing = await db.words.get(key);
        const books = new Set(existing ? existing.books : []);
        books.add(bookId);
        await db.words.put({
          ...(existing || w),
          w: key,
          books: [...books],
        });
      }
    });
    inserted += chunk.length;
    onProgress?.(inserted, total);
  }
  return inserted;
}

/** 卸载词库：移除词条上的词库标记；不再被任何词库引用且未被学习过的词条一并删除 */
export async function uninstallBook(bookId: string): Promise<void> {
  await db.transaction('rw', db.words, db.userWords, async () => {
    const words = await db.words.where('books').equals(bookId).toArray();
    for (const w of words) {
      const remaining = w.books.filter((b) => b !== bookId);
      const learned = await db.userWords.get(w.w);
      if (remaining.length === 0 && !learned) {
        await db.words.delete(w.w);
      } else {
        await db.words.put({ ...w, books: remaining });
      }
    }
  });
}

/** 已安装词库的单词总数 */
export async function countInstalledWords(): Promise<number> {
  return db.words.count();
}

/**
 * 获取指定词库中「尚未学习」的新词队列。
 * 所有激活词库的候选词合并后按 COCA 词频升序（常用词优先），limit 限制数量。
 * 多词库间公平参与，避免高词量词库垄断队列（旧实现内层 break 会导致后续词库不参与）。
 */
export async function getNewWordQueue(bookIds: string[], limit: number): Promise<Word[]> {
  if (bookIds.length === 0 || limit <= 0) return [];
  const learned = await getLearnedWordIds();
  const seen = new Set<string>();
  const candidates: Word[] = [];
  for (const bookId of bookIds) {
    const words = await db.words.where('books').equals(bookId).toArray();
    for (const w of words) {
      if (learned.has(w.w) || seen.has(w.w)) continue;
      seen.add(w.w);
      candidates.push(w);
    }
  }
  candidates.sort((a, b) => (a.freq ?? Number.MAX_SAFE_INTEGER) - (b.freq ?? Number.MAX_SAFE_INTEGER));
  return candidates.slice(0, limit);
}

/** 激活词库中尚未学习的词数（跨词库去重，首页「还剩 N 个」用） */
export async function countNewWords(bookIds: string[]): Promise<number> {
  if (bookIds.length === 0) return 0;
  const learned = await getLearnedWordIds();
  const seen = new Set<string>();
  let count = 0;
  for (const bookId of bookIds) {
    const words = await db.words.where('books').equals(bookId).toArray();
    for (const w of words) {
      if (learned.has(w.w) || seen.has(w.w)) continue;
      seen.add(w.w);
      count++;
    }
  }
  return count;
}

/**
 * 已学单词全集（带内存缓存）。
 * 首次调用全量加载，之后复用；数据被批量改动时由 invalidateLearnedCache 失效。
 */
export async function getLearnedWordIds(force = false): Promise<Set<string>> {
  const cached = getLearnedCache();
  if (cached && !force) return cached;
  const keys = (await db.userWords.toCollection().primaryKeys()) as string[];
  setLearnedCache(new Set(keys));
  return getLearnedCache()!;
}

/** 按 ID 查词条 */
export async function getWord(wordId: string): Promise<Word | undefined> {
  return db.words.get(wordId.toLowerCase());
}

/** 批量查词条 */
export async function getWords(wordIds: string[]): Promise<Word[]> {
  const keys = wordIds.map((id) => id.toLowerCase());
  return db.words.bulkGet(keys).then((list) => list.filter((w): w is Word => !!w));
}

/** 全文搜索词条（单词前缀匹配，最多 N 条） */
export async function searchWords(query: string, limit = 20): Promise<Word[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = await db.words.where('w').startsWith(q).limit(limit).toArray();
  return words;
}

/** 随机取样词条（四选一干扰项用），排除指定词 */
export async function getRandomWords(count: number, exclude: Set<string> = new Set()): Promise<Word[]> {  const total = await db.words.count();
  if (total === 0) return [];
  const seen = new Set(exclude);
  const out: Word[] = [];
  let attempts = 0;
  while (out.length < count && attempts < 40) {
    attempts++;
    const offset = Math.floor(Math.random() * Math.max(1, total));
    const batch = await db.words.offset(offset).limit(count * 2).toArray();
    for (const w of batch) {
      if (!seen.has(w.w) && w.m.length > 0) {
        seen.add(w.w);
        out.push(w);
      }
      if (out.length >= count) break;
    }
  }
  return out;
}

// ---- 自定义导入 ----

/** 解析用户导入的 JSON（兼容 qwerty-learner 格式） */
export function parseCustomJson(text: string): Word[] {
  // 剥离 UTF-8 BOM（部分编辑器/Excel 导出会带上，JSON.parse 遇 BOM 会直接失败）
  const data = JSON.parse(text.replace(/^\uFEFF/, ''));
  const list = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(list)) throw new Error('JSON 格式不正确：应为词条数组');
  return list.map((item: Record<string, unknown>): Word => {
    const name = String(item.name ?? item.word ?? '').trim();
    if (!name) throw new Error('存在缺少 name 的词条');
    const trans = Array.isArray(item.trans) ? item.trans : [item.trans].filter((t) => t != null);
    const meanings = trans.map((t) => String(t).trim()).filter(Boolean);
    if (meanings.length === 0) throw new Error(`词条 ${name} 缺少释义 trans`);
    const sentence = String(item.sentence ?? '').trim();
    const freqRaw = item.freq;
    const freq = freqRaw != null && Number(freqRaw) > 0 ? Math.round(Number(freqRaw)) : null;
    return {
      w: name,
      uk: String(item.ukphone ?? '').trim(),
      us: String(item.usphone ?? '').trim(),
      m: meanings,
      pos: String(item.pos ?? '').trim(),
      ex: sentence ? [sentence] : [],
      freq,
      books: [],
    };
  });
}

/** 解析用户导入的 CSV（表头 name,trans,usphone,ukphone,sentence,pos,freq，freq 可选） */
export function parseCustomCsv(text: string): Word[] {
  // 剥离 UTF-8 BOM（Excel 导出的 UTF-8 CSV 常带 BOM，docs/IMPORT_FORMAT.md 已建议使用）
  text = text.replace(/^\uFEFF/, '');
  // 简易 CSV 解析：支持双引号包裹的字段
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuote = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    for (const ch of line) {
      if (inQuote) {
        if (ch === '"') inQuote = false;
        else cur += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    row.push(cur);
    cur = '';
    inQuote = false;
    rows.push(row);
    row = [];
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col('name');
  const iTrans = col('trans');
  if (iName === -1 || iTrans === -1) throw new Error('CSV 表头必须包含 name 和 trans');
  const iUs = col('usphone');
  const iUk = col('ukphone');
  const iSent = col('sentence');
  const iPos = col('pos');
  const iFreq = col('freq');

  const words: Word[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = (cells[iName] ?? '').trim();
    if (!name) continue;
    const meanings = (cells[iTrans] ?? '')
      .split(/[;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (meanings.length === 0) continue;
    const freqRaw = iFreq >= 0 ? Number((cells[iFreq] ?? '').trim()) : NaN;
    words.push({
      w: name,
      uk: iUk >= 0 ? (cells[iUk] ?? '').trim() : '',
      us: iUs >= 0 ? (cells[iUs] ?? '').trim() : '',
      m: meanings,
      pos: iPos >= 0 ? (cells[iPos] ?? '').trim() : '',
      ex: iSent >= 0 && cells[iSent] ? [(cells[iSent] ?? '').trim()] : [],
      freq: freqRaw > 0 ? Math.round(freqRaw) : null,
      books: [],
    });
  }
  if (words.length === 0) throw new Error('CSV 中没有解析到有效词条');
  return words;
}

/**
 * 导入自定义词表到指定词书（bookId 默认 'custom'，可用 'custom:名称' 区分多本词书）。
 * 与现有词条按小写单词合并：已存在的更新释义/音标/例句。
 * 同名词书多次导入 = 分批追加；不同名 = 独立词书。
 */
export async function importCustomWords(
  words: Word[],
  bookId = 'custom',
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let inserted = 0;
  const BATCH = 300;
  for (let i = 0; i < words.length; i += BATCH) {
    const chunk = words.slice(i, i + BATCH);
    await db.transaction('rw', db.words, async () => {
      for (const w of chunk) {
        const key = w.w.toLowerCase();
        const existing = await db.words.get(key);
        const books = new Set(existing ? existing.books : []);
        books.add(bookId);
        // 自定义导入：新数据优先（更新释义/音标/例句/词频），保留词库归属
        await db.words.put({
          ...(existing || w),
          ...w,
          w: key,
          books: [...books],
        });
      }
    });
    inserted += chunk.length;
    onProgress?.(inserted, words.length);
  }
  // 词库已变更：触发本地文件夹自动同步（防抖，未配置时静默跳过）
  scheduleSync();
  return inserted;
}

/** 自定义词书信息 */
export interface CustomBookInfo {
  id: string;
  name: string;
  count: number;
}

/** 自定义词书 id → 显示名（'custom' → 我的词库；'custom:xxx' → xxx） */
export function customBookName(id: string): string {
  if (id === 'custom') return '我的词库';
  return id.startsWith('custom:') ? id.slice('custom:'.length) : id;
}

/** 是否为自定义词书 id（'custom' 或 'custom:名称'） */
export function isCustomBookId(id: string): boolean {
  return id === 'custom' || id.startsWith('custom:');
}

/** 词条是否来自自定义词书（自定义词的 freq 是导入顺序号而非 COCA 词频，展示需区分） */
export function isCustomWord(word: Pick<Word, 'books'>): boolean {
  return word.books.some(isCustomBookId);
}

/** 列出全部自定义词书及其词数（从 words 表的 books 标记汇总） */
export async function getCustomBooks(): Promise<CustomBookInfo[]> {
  const all = await db.words.toArray();
  const map = new Map<string, number>();
  for (const w of all) {
    for (const b of w.books) {
      if (b === 'custom' || b.startsWith('custom:')) map.set(b, (map.get(b) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([id, count]) => ({ id, name: customBookName(id), count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

// ---- 词表浏览（词表页） ----

/** 词表条目：词条 + 学习状态（userWord 为空 = 未学） */
export interface WordWithStatus {
  word: Word;
  userWord: UserWord | null;
  /** 掌握度分类（未学 = 'new'） */
  mastery: 'new' | 'learning' | 'consolidating' | 'mastered';
  /** 是否到期待复习（有卡且 due <= now） */
  due: boolean;
}

export interface ListWordsOptions {
  /** 限定某本已安装词书 */
  bookId?: string;
  /** 学习状态过滤 */
  status?: 'all' | 'new' | 'learning' | 'consolidating' | 'mastered' | 'due';
  /** 单词前缀搜索 */
  query?: string;
  /** 返回条数上限（默认 300） */
  limit?: number;
}

/**
 * 词表查询：词书筛选 + 状态筛选 + 前缀搜索，按 COCA 词频升序（常用词优先，未知词频排最后）。
 * 词表页/全局搜索共用；多词库共有词自动去重（words 主键唯一）。
 */
export async function listWordsWithStatus(opts: ListWordsOptions = {}): Promise<WordWithStatus[]> {
  const { bookId, status = 'all', query, limit = 300 } = opts;
  let words: Word[];
  if (query && query.trim()) {
    words = await searchWords(query, Math.max(limit, 100));
  } else if (bookId) {
    words = await db.words.where('books').equals(bookId).toArray();
  } else {
    words = await db.words.toArray();
  }
  // 词书筛选（搜索命中词也要校验归属）
  if (bookId) words = words.filter((w) => w.books.includes(bookId));
  // 关联学习状态
  const userWords = await db.userWords.bulkGet(words.map((w) => w.w));
  const uwMap = new Map<string, UserWord>();
  for (const uw of userWords) {
    if (uw) uwMap.set(uw.wordId, uw);
  }
  const now = Date.now();
  const list: WordWithStatus[] = words.map((word) => {
    const userWord = uwMap.get(word.w) ?? null;
    const mastery = userWord ? classifyMastery(userWord) : 'new';
    const due = !!userWord && userWord.due <= now;
    return { word, userWord, mastery, due };
  });
  // 状态过滤
  const filtered =
    status === 'all'
      ? list
      : status === 'new'
        ? list.filter((i) => !i.userWord)
        : status === 'due'
          ? list.filter((i) => i.due)
          : list.filter((i) => i.mastery === status);
  // 排序：词频升序（null 最后）；同频按字母序
  filtered.sort(
    (a, b) =>
      (a.word.freq ?? Number.MAX_SAFE_INTEGER) - (b.word.freq ?? Number.MAX_SAFE_INTEGER) ||
      a.word.w.localeCompare(b.word.w),
  );
  return filtered.slice(0, limit);
}

/** 已安装词书列表（内置已安装 + 自定义），词表页筛选用 */
export async function getInstalledBooks(): Promise<{ id: string; name: string; count: number }[]> {
  const manifest = await fetchManifest();
  const installed: { id: string; name: string; count: number }[] = [];
  for (const b of manifest) {
    if (await isBookInstalled(b.id)) installed.push({ id: b.id, name: b.name, count: b.count });
  }
  const customs = await getCustomBooks();
  return [...installed, ...customs];
}
