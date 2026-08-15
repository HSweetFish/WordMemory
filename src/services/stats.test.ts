import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { rebuildDailyStats, getTodayReviewCount, getTodayReviewQuotaUsed } from '@/services/stats';
import { dateKey } from '@/lib/format';
import { State } from '@/types';

/** 直接构造一条答题日志（绕开会话层，聚焦统计重建逻辑） */
function log(wordId: string, mode: 'learn' | 'review' | 'random', rating: number, reviewedAt: number) {
  return { wordId, rating, elapsedMs: 1000, reviewedAt, scheduledDays: 1, state: State.Review, mode };
}

describe('重建统计数据', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('从答题记录全量重算每日统计（去重/复习口径/跨天分组）', async () => {
    const now = Date.now();
    const yesterday = now - 86400000;
    await db.reviewLogs.bulkAdd([
      // 今天：apple 学两次（新学 + 回炉），banana 学一次，cherry 复习一次
      log('apple', 'learn', 3, now - 60000),
      log('apple', 'learn', 1, now - 30000), // 回炉：不重复计新学
      log('banana', 'learn', 2, now - 10000),
      log('cherry', 'review', 4, now),
      // 昨天：apple 复习答错
      log('apple', 'review', 1, yesterday),
    ]);

    const result = await rebuildDailyStats();
    expect(result.logs).toBe(5);
    expect(result.days).toBe(2);

    const stats = await db.dailyStats.toArray();
    expect(stats).toHaveLength(2);
    const byDate = Object.fromEntries(stats.map((s) => [s.date, s]));
    const today = byDate[dateKey(new Date(now))];
    const yest = byDate[dateKey(new Date(yesterday))];
    expect(today).toBeDefined();
    expect(yest).toBeDefined();

    // 今天：新学去重 = apple + banana = 2（回炉不重复计）；复习 = cherry = 1；总 = 4
    expect(today.newCount).toBe(2);
    expect(today.reviewCount).toBe(1);
    expect(today.correctCount).toBe(2); // apple 3 + cherry 4
    expect(today.totalCount).toBe(4);
    // 昨天：复习 apple 答错 = 1
    expect(yest.newCount).toBe(0);
    expect(yest.reviewCount).toBe(1);
    expect(yest.correctCount).toBe(0);
    expect(yest.totalCount).toBe(1);
  });

  it('今日复习口径含抽查：展示统计与配额消耗分离', async () => {
    const now = Date.now();
    await db.reviewLogs.bulkAdd([
      log('apple', 'review', 4, now - 60000), // 排程复习
      log('banana', 'random', 3, now - 30000), // 抽查
      log('cherry', 'review', 1, now - 10000), // 复习答错：计入展示、不消耗配额
      log('durian', 'learn', 2, now), // 新学：不计入复习
    ]);

    // 展示口径：排程复习 + 抽查 = 3（答错也算打卡）
    expect(await getTodayReviewCount()).toBe(3);
    // 配额口径：仅答对（评分≥3）的排程复习 = 1（抽查不占配额、答错不占配额）
    expect(await getTodayReviewQuotaUsed()).toBe(1);
  });

  it('复习按词去重：同一词当天多次作答（回炉补考）只算 1 个词', async () => {
    const now = Date.now();
    await db.reviewLogs.bulkAdd([
      log('apple', 'review', 2, now - 60000), // Hard → 回炉
      log('apple', 'review', 3, now - 30000), // 补考答对
      log('apple', 'review', 3, now - 10000), // 又答对（当天第三次）
      log('banana', 'review', 4, now),        // 另一个词
    ]);

    // 展示口径：按词去重 = apple + banana = 2（不是 4 次）
    expect(await getTodayReviewCount()).toBe(2);

    const { days } = await rebuildDailyStats();
    expect(days).toBe(1);
    const stats = await db.dailyStats.toArray();
    // 复习词数去重 = 2，答题次数 totalCount 仍是 4（累计答题体现次数）
    expect(stats[0].reviewCount).toBe(2);
    expect(stats[0].totalCount).toBe(4);
    // 配额口径：答对（≥3）的排程复习 = 3 次（Hard 回炉不消耗配额，补考答对消耗）
    expect(await getTodayReviewQuotaUsed()).toBe(3);
  });

  it('重建时保留旧时长（时长由会话层累加，日志无法还原）', async () => {
    const now = Date.now();
    const today = dateKey(new Date(now));
    await db.reviewLogs.add(log('apple', 'learn', 3, now));
    // 模拟旧缓存：今天有学习时长，另有一个无日志的脏日期
    await db.dailyStats.bulkPut([
      { date: today, newCount: 99, reviewCount: 99, correctCount: 99, totalCount: 99, durationSec: 12345 },
      { date: '20000101', newCount: 1, reviewCount: 0, correctCount: 0, totalCount: 1, durationSec: 60 },
    ]);

    await rebuildDailyStats();

    const stats = await db.dailyStats.toArray();
    // 脏日期（无日志）被清除，只有今天的统计
    expect(stats).toHaveLength(1);
    expect(stats[0].date).toBe(today);
    // 计数按日志重算（不是旧的 99），时长保留旧值
    expect(stats[0].newCount).toBe(1);
    expect(stats[0].totalCount).toBe(1);
    expect(stats[0].durationSec).toBe(12345);
  });
});
