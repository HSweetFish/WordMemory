import { db } from '@/db/schema';
import type { DailyStat, ReviewLog } from '@/types';
import { Rating } from '@/types';
import { dateKey, dateKeyOffset, lastNDays, dayRangeInZone, shiftDateKey } from '@/lib/format';

/**
 * 统计服务：每日聚合 + 各类查询
 * 聚合任务策略：daily_stats 为增量缓存，缺失时从 review_logs 重算回填，保证数据一致。
 */

/** 增量更新某一天统计（每次答题后调用，避免全量重算）
 * 口径：totalCount/correctCount 是「次数」（累计答题体现），
 * newCount 是当天 learn 且评分≥2 的词数（按词去重），
 * reviewCount 是当天 review/random 的词数（按词去重，回炉补考不重复计）。
 * 两个去重标志 isNewWord / isNewReview 由调用方在日志写入前算好传入
 * （写入后查询会包含当前日志，无法判断「首次」）。
 */
export async function addReviewStat(
  date: string,
  mode: 'learn' | 'review' | 'random',
  rating: number,
  durationSec: number,
  opts: { isNewWord?: boolean; isNewReview?: boolean } = {},
): Promise<void> {
  const existing = await db.dailyStats.get(date);
  const stat: DailyStat = existing ?? { date, newCount: 0, reviewCount: 0, correctCount: 0, totalCount: 0, durationSec: 0 };
  stat.totalCount += 1;
  if (mode === 'learn') {
    // 新学口径：仅首次「学会」（learn 且评分≥2）计入，与按日志去重的口径一致
    if (opts.isNewWord && rating >= 2) stat.newCount += 1;
  } else {
    // 复习口径：按词去重（该词当天首次复习才 +1，回炉补考不重复计）
    if (opts.isNewReview) stat.reviewCount += 1;
  }
  if (rating >= 3) stat.correctCount += 1;
  stat.durationSec += durationSec;
  await db.dailyStats.put(stat);
}

/** 从 review_logs 重算某一天的聚合值 */
export async function aggregateDailyStat(date: string): Promise<DailyStat> {
  const [start, end] = dayRangeInZone(date);
  const logs = await db.reviewLogs.where('reviewedAt').between(start, end).toArray();
  const stat: DailyStat = {
    date,
    // 新学口径：当天 learn 且评分≥2 的词按 wordId 去重（回炉不重复计）
    newCount: new Set(logs.filter((l) => l.mode === 'learn' && l.rating >= 2).map((l) => l.wordId)).size,
    reviewCount: new Set(logs.filter((l) => l.mode === 'review' || l.mode === 'random').map((l) => l.wordId)).size,
    correctCount: logs.filter((l) => l.rating >= 3).length,
    totalCount: logs.length,
    durationSec: 0, // 时长由会话层累加，见 addDurationSec
  };
  const existing = await db.dailyStats.get(date);
  if (existing && existing.durationSec > 0) stat.durationSec = existing.durationSec;
  await db.dailyStats.put(stat);
  return stat;
}

/** 确保指定日期列表的 daily_stats 都存在（缺失回填），dates 须升序 */
export async function ensureDailyStatsRange(dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const rows = (await db.dailyStats.bulkGet(dates)).filter((d): d is DailyStat => !!d);
  const existing = new Set(rows.map((d) => d.date));
  const missing = dates.filter((d) => !existing.has(d));
  if (missing.length === 0) return;

  // 单次范围查询拉取所有缺失日期区间的日志，按天分组回填（旧实现逐日范围查询最多 90 次）
  const [start] = dayRangeInZone(missing[0]);
  const [, end] = dayRangeInZone(missing[missing.length - 1]);
  const logs = await db.reviewLogs.where('reviewedAt').between(start, end).toArray();

  const byDate = new Map<string, ReviewLog[]>();
  const missingSet = new Set(missing);
  for (const log of logs) {
    const key = dateKey(new Date(log.reviewedAt));
    if (!missingSet.has(key)) continue;
    const arr = byDate.get(key) ?? [];
    arr.push(log);
    byDate.set(key, arr);
  }

  // 保留已有记录的时长（时长由会话层累加，日志无法还原）
  const durationMap = new Map(rows.map((d) => [d.date, d.durationSec]));
  for (const date of missing) {
    const dayLogs = byDate.get(date) ?? [];
    const stat: DailyStat = {
      date,
      // 新学口径与 aggregateDailyStat 一致：当天 learn 且评分≥2 的词去重
      newCount: new Set(dayLogs.filter((l) => l.mode === 'learn' && l.rating >= 2).map((l) => l.wordId)).size,
      // 复习口径与 aggregateDailyStat 一致：复习 + 抽查按词去重（回炉补考不重复计）
      reviewCount: new Set(dayLogs.filter((l) => l.mode === 'review' || l.mode === 'random').map((l) => l.wordId)).size,
      correctCount: dayLogs.filter((l) => l.rating >= 3).length,
      totalCount: dayLogs.length,
      durationSec: durationMap.get(date) ?? 0,
    };
    await db.dailyStats.put(stat);
  }
}

/** 确保最近 N 天的 daily_stats 都存在（缺失回填） */
export async function ensureDailyStats(days = 90): Promise<void> {
  await ensureDailyStatsRange(lastNDays(days));
}

/** 获取 [fromKey, toKey] 闭区间内每日统计（升序），缺失日期自动回填为 0 */
export async function getDailyStatsRange(fromKey: string, toKey: string): Promise<DailyStat[]> {
  const dates: string[] = [];
  let cur = fromKey;
  let guard = 0;
  while (cur <= toKey && guard < 400) {
    dates.push(cur);
    cur = shiftDateKey(cur, 1);
    guard++;
  }
  await ensureDailyStatsRange(dates);
  const stats = await db.dailyStats.bulkGet(dates);
  return dates.map((date) => {
    const found = stats.find((s) => s?.date === date);
    return found ?? { date, newCount: 0, reviewCount: 0, correctCount: 0, totalCount: 0, durationSec: 0 };
  });
}

/** 获取最近 N 天统计（升序），缺失日期自动回填为 0 */
export async function getDailyStats(days: number): Promise<DailyStat[]> {
  await ensureDailyStats(days);
  const dates = lastNDays(days);
  const stats = await db.dailyStats.bulkGet(dates);
  return dates.map((date) => {
    const found = stats.find((s) => s?.date === date);
    return found ?? { date, newCount: 0, reviewCount: 0, correctCount: 0, totalCount: 0, durationSec: 0 };
  });
}

/** 从 review_logs 全量重算 daily_stats（修复历史脏数据）
 * 每次答题的原始记录（review_logs）是唯一事实来源，daily_stats 只是增量缓存；
 * 旧版本的口径 bug 可能写入错误计数，此函数丢弃缓存、按当前口径重建全部日统计。
 * 学习时长（durationSec）由会话层累加、日志无法还原，重建时保留旧值。
 * @returns 重建的统计天数与处理的日志条数
 */
export async function rebuildDailyStats(): Promise<{ days: number; logs: number }> {
  // 1. 保留旧时长（时长无法从日志还原）
  const oldStats = await db.dailyStats.toArray();
  const durationMap = new Map(oldStats.map((s) => [s.date, s.durationSec]));

  // 2. 全量日志按天分组
  const logs = await db.reviewLogs.toArray();
  const byDate = new Map<string, ReviewLog[]>();
  for (const log of logs) {
    const key = dateKey(new Date(log.reviewedAt));
    const arr = byDate.get(key) ?? [];
    arr.push(log);
    byDate.set(key, arr);
  }

  // 3. 清空缓存，按当前口径重建（与 aggregateDailyStat / ensureDailyStatsRange 完全一致）
  await db.dailyStats.clear();
  const stats: DailyStat[] = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, dayLogs]) => ({
      date,
      // 新学口径：当天 learn 且评分≥2 的词按 wordId 去重（回炉/重学不重复计）
      newCount: new Set(dayLogs.filter((l) => l.mode === 'learn' && l.rating >= 2).map((l) => l.wordId)).size,
      // 复习口径：复习 + 抽查按词去重（回炉补考不重复计）
      reviewCount: new Set(dayLogs.filter((l) => l.mode === 'review' || l.mode === 'random').map((l) => l.wordId)).size,
      correctCount: dayLogs.filter((l) => l.rating >= 3).length,
      totalCount: dayLogs.length,
      durationSec: durationMap.get(date) ?? 0,
    }));
  if (stats.length > 0) await db.dailyStats.bulkPut(stats);
  return { days: stats.length, logs: logs.length };
}

/** 连续打卡天数（今天有记录算今天，否则从昨天往前数） */
export async function computeStreak(): Promise<number> {
  const today = dateKey();
  const todayStat = await db.dailyStats.get(today);
  let cursor = todayStat && todayStat.totalCount > 0 ? 0 : -1;
  let streak = 0;
  while (true) {
    const stat = await db.dailyStats.get(dateKeyOffset(cursor));
    if (!stat || stat.totalCount === 0) break;
    streak++;
    cursor--;
  }
  return streak;
}

/** 待复习数量（due <= now） */
export async function getDueCount(): Promise<number> {
  return db.userWords.where('due').belowOrEqual(Date.now()).count();
}

/** 今日已学新词数量（review_logs 中今天 mode=learn 且评分≥2（排除“没学会”）的词，按词去重；回炉不重复计） */
export async function getTodayNewCount(): Promise<number> {
  const [start] = dayRangeInZone(dateKey());
  const logs = await db.reviewLogs.where('reviewedAt').aboveOrEqual(start).toArray();
  return new Set(logs.filter((l) => l.mode === 'learn' && l.rating >= 2).map((l) => l.wordId)).size;
}

/**
 * 今日已复习单词数（按词去重，含抽查；与 daily_stats.reviewCount / 热力图「复习」口径一致：
 * 抽查也是复习行为，应计入当天打卡与复习统计；同一词当天多次作答（回炉补考）只算 1 个词，
 * 答题次数在「累计答题」体现。配额消耗另行用 getTodayReviewQuotaUsed 只算排程复习）
 */
export async function getTodayReviewCount(): Promise<number> {
  const [start] = dayRangeInZone(dateKey());
  const logs = await db.reviewLogs.where('reviewedAt').aboveOrEqual(start).toArray();
  return new Set(logs.filter((l) => l.mode === 'review' || l.mode === 'random').map((l) => l.wordId)).size;
}

/**
 * 今日已消耗的复习配额数（配额口径：仅答对计入）。
 * 答错的词不消耗当日配额，可立即再次进入复习队列补考。
 */
export async function getTodayReviewQuotaUsed(): Promise<number> {
  const [start] = dayRangeInZone(dateKey());
  const logs = await db.reviewLogs.where('reviewedAt').aboveOrEqual(start).toArray();
  return logs.filter((l) => l.mode === 'review' && l.rating >= 3).length;
}

/** 掌握度分布：各 FSRS 状态的单词数 */
export async function getMasteryDistribution(): Promise<{ state: number; count: number }[]> {
  const cards = await db.userWords.toArray();
  const map = new Map<number, number>();
  for (const c of cards) map.set(c.state, (map.get(c.state) ?? 0) + 1);
  return [...map.entries()].map(([state, count]) => ({ state, count }));
}

/** 总学习词数 */
export async function getLearnedWordCount(): Promise<number> {
  return db.userWords.count();
}

/** 累计答题总数 */
export async function getTotalLogCount(): Promise<number> {
  return db.reviewLogs.count();
}

/** 各词库已学习数量分布 */
export async function getLearnedByBook(): Promise<{ bookId: string; count: number }[]> {
  const cards = await db.userWords.toArray();
  const map = new Map<string, number>();
  for (const c of cards) {
    for (const b of c.bookIds) map.set(b, (map.get(b) ?? 0) + 1);
  }
  return [...map.entries()].map(([bookId, count]) => ({ bookId, count }));
}

/** 最近 N 天答题记录（供图表/AI 分析使用）
 * 起始边界固定按东八区当天 00:00，不随设备本地时区漂移（见 lib/format）。 */
export async function getRecentLogs(days: number): Promise<ReviewLog[]> {
  const [since] = dayRangeInZone(dateKeyOffset(-(days - 1)));
  return db.reviewLogs.where('reviewedAt').aboveOrEqual(since).toArray();
}

/** 某个单词的全部答题记录（供遗忘曲线拟合） */
export async function getLogsForWord(wordId: string): Promise<ReviewLog[]> {
  return db.reviewLogs.where('wordId').equals(wordId.toLowerCase()).sortBy('reviewedAt');
}

/** 薄弱词：按 review_logs 统计「没掌握」的答题次数（Again + Hard 均计入——两档都会
 * 触发回炉重学，都代表薄弱）。基于日志统计而非 userWords.wrongCount：学习流程的
 * 「回忆确认记错」会删除卡片重建（resetWordLearning），卡片上的 wrongCount 被清零
 * 导致历史答错丢失；日志永久保留，口径与「记忆历史」一致。
 * 排序：总薄弱次数降序，同分时明确没记住（Again）更多的靠前。 */
export interface WeakWordStat {
  wordId: string;
  /** 薄弱总次数 = Again + Hard */
  wrongCount: number;
  /** 明确没记住（第一档）次数 */
  againCount: number;
  /** 模糊/勉强（第二档）次数 */
  hardCount: number;
  lastRating: number | null;
}

export async function getWeakWords(limit = 20): Promise<WeakWordStat[]> {
  const logs = await db.reviewLogs.toArray();
  const again = new Map<string, number>();
  const hard = new Map<string, number>();
  for (const l of logs) {
    if (l.rating === Rating.Again) again.set(l.wordId, (again.get(l.wordId) ?? 0) + 1);
    else if (l.rating === Rating.Hard) hard.set(l.wordId, (hard.get(l.wordId) ?? 0) + 1);
  }
  const ids = new Set([...again.keys(), ...hard.keys()]);
  const cards = await db.userWords.toArray();
  const lastRating = new Map(cards.map((c) => [c.wordId, c.lastRating]));
  return [...ids]
    .map((wordId) => {
      const againCount = again.get(wordId) ?? 0;
      const hardCount = hard.get(wordId) ?? 0;
      return {
        wordId,
        wrongCount: againCount + hardCount,
        againCount,
        hardCount,
        lastRating: lastRating.get(wordId) ?? null,
      };
    })
    .sort((a, b) => b.wrongCount - a.wrongCount || b.againCount - a.againCount)
    .slice(0, limit);
}
