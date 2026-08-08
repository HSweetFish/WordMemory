import Dexie, { type Table } from 'dexie';
import { invalidateLearnedCache } from '@/services/learned-cache';
import type { Word, UserWord, ReviewLog, DailyStat } from '@/types';

/**
 * 本地数据库（IndexedDB via Dexie）
 * local-first：所有学习数据保存在浏览器本地，离线可用。
 */
export class WordMemoryDB extends Dexie {
  /** 词条表（跨词库合并存储，主键 = 小写单词） */
  words!: Table<Word, string>;
  /** 用户单词学习状态（FSRS 卡片） */
  userWords!: Table<UserWord, string>;
  /** 答题事件流水（记录系统的数据底座） */
  reviewLogs!: Table<ReviewLog, number>;
  /** 每日聚合统计 */
  dailyStats!: Table<DailyStat, string>;
  /** 元数据表（键值对，存本地同步文件夹句柄等） */
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('wordmemory');
    this.version(1).stores({
      words: 'w, *books, freq',
      userWords: 'wordId, due, state, *bookIds',
      reviewLogs: '++id, wordId, reviewedAt, mode, rating',
      dailyStats: 'date',
    });
    // v2：新增 meta 表，用于保存「本地文件夹同步」的目录句柄（不随学习数据清除）
    this.version(2).stores({
      words: 'w, *books, freq',
      userWords: 'wordId, due, state, *bookIds',
      reviewLogs: '++id, wordId, reviewedAt, mode, rating',
      dailyStats: 'date',
      meta: 'key',
    });
  }
}

export const db = new WordMemoryDB();

/** 清空全部数据（含词库，谨慎使用） */
export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', db.words, db.userWords, db.reviewLogs, db.dailyStats, async () => {
    await Promise.all([
      db.words.clear(),
      db.userWords.clear(),
      db.reviewLogs.clear(),
      db.dailyStats.clear(),
    ]);
  });
  invalidateLearnedCache();
}

/** 清空全部数据 + 本地同步句柄（词库/学习进度/统计/meta 全清）—— 「从零开始」用，设置由调用方决定保留项 */
export async function resetAllData(): Promise<void> {
  await db.transaction('rw', db.words, db.userWords, db.reviewLogs, db.dailyStats, db.meta, async () => {
    await Promise.all([
      db.words.clear(),
      db.userWords.clear(),
      db.reviewLogs.clear(),
      db.dailyStats.clear(),
      db.meta.clear(),
    ]);
  });
  invalidateLearnedCache();
}

/** 清空学习进度（FSRS 卡片/答题记录/每日统计），保留已安装词库与设置 —— 「重新开始背」用 */
export async function clearLearningProgress(): Promise<void> {
  await db.transaction('rw', db.userWords, db.reviewLogs, db.dailyStats, async () => {
    await Promise.all([db.userWords.clear(), db.reviewLogs.clear(), db.dailyStats.clear()]);
  });
  invalidateLearnedCache();
}
