import { db } from '@/db/schema';
import { invalidateLearnedCache } from '@/services/learned-cache';
import type { DailyStat, ReviewLog, Settings, UserWord, Word } from '@/types';
import { useSettings } from '@/stores/settings';
import { dateKey, lastNDays } from '@/lib/format';

/**
 * 数据导出 / 备份 / 恢复
 * 所有学习数据均为本地私有数据，支持一键导出 JSON 备份。
 */

export interface BackupData {
  app: 'wordmemory';
  version: 1;
  exportedAt: string;
  settings: Settings;
  words: Word[];
  userWords: UserWord[];
  reviewLogs: ReviewLog[];
  dailyStats: DailyStat[];
}

/** 导出全部数据为 JSON 字符串 */
export async function exportAllData(): Promise<string> {
  const [words, userWords, reviewLogs, dailyStats] = await Promise.all([
    db.words.toArray(),
    db.userWords.toArray(),
    db.reviewLogs.toArray(),
    db.dailyStats.toArray(),
  ]);
  const backup: BackupData = {
    app: 'wordmemory',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: useSettings.getState().settings,
    words,
    userWords,
    reviewLogs,
    dailyStats,
  };
  return JSON.stringify(backup);
}

/** 下载备份文件到本地 */
export async function downloadBackup(): Promise<void> {
  const json = await exportAllData();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wordmemory-backup-${dateKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 从 JSON 恢复备份（覆盖当前数据） */
export async function restoreBackup(json: string): Promise<BackupData> {
  const data = JSON.parse(json) as BackupData;
  if (data.app !== 'wordmemory') throw new Error('不是有效的词忆备份文件');
  await db.transaction('rw', db.words, db.userWords, db.reviewLogs, db.dailyStats, async () => {
    await Promise.all([db.words.clear(), db.userWords.clear(), db.reviewLogs.clear(), db.dailyStats.clear()]);
    if (data.words.length) await db.words.bulkPut(data.words);
    if (data.userWords.length) await db.userWords.bulkPut(data.userWords);
    if (data.reviewLogs.length) await db.reviewLogs.bulkAdd(data.reviewLogs);
    if (data.dailyStats.length) await db.dailyStats.bulkPut(data.dailyStats);
  });
  invalidateLearnedCache();
  useSettings.getState().set(data.settings);
  return data;
}

/** 统计某个时间段内每天打卡数据（供热力图/趋势图/AI 周报） */
export function summarizeStats(stats: DailyStat[]): { activeDays: number; totalNew: number; totalReview: number; totalAnswered: number; correctRate: number } {
  const totalAnswered = stats.reduce((s, d) => s + d.totalCount, 0);
  const totalCorrect = stats.reduce((s, d) => s + d.correctCount, 0);
  return {
    activeDays: stats.filter((d) => d.totalCount > 0).length,
    totalNew: stats.reduce((s, d) => s + d.newCount, 0),
    totalReview: stats.reduce((s, d) => s + d.reviewCount, 0),
    totalAnswered,
    correctRate: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
  };
}

/** 最近 N 天的日期序列（含今天） */
export { lastNDays };
