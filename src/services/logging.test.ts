import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { recordRating } from '@/services/study';
import { installBookData } from '@/services/wordbook';
import { getDailyStats, getRecentLogs, getWeakWords, getLogsForWord } from '@/services/stats';
import { exportAllData, restoreBackup, summarizeStats } from '@/services/dataio';
import { useSettings } from '@/stores/settings';
import { dateKey, dayRangeInZone } from '@/lib/format';
import { Rating, State } from '@/types';

const WORDS = [
  { w: 'apple', uk: '', us: '', m: ['苹果'], pos: 'n.', ex: [], freq: 10, books: [] },
  { w: 'banana', uk: '', us: '', m: ['香蕉'], pos: 'n.', ex: [], freq: 20, books: [] },
  { w: 'cherry', uk: '', us: '', m: ['樱桃'], pos: 'n.', ex: [], freq: 30, books: [] },
];

describe('记录系统', () => {
  beforeEach(async () => {
    await resetDatabase();
    useSettings.getState().set({ activeBooks: ['testbook'] });
    await installBookData('testbook', WORDS);
  });

  it('事件完整性：每条答题记录含评分/反应时长/排程/状态/模式', async () => {
    await recordRating(WORDS[0], null, Rating.Hard, 'learn', 2500);
    await recordRating(WORDS[1], null, Rating.Easy, 'learn', 1800);
    await recordRating(WORDS[2], null, Rating.Again, 'review', 900);

    const logs = await db.reviewLogs.orderBy('id').toArray();
    expect(logs).toHaveLength(3);

    const hard = logs[0];
    expect(hard.wordId).toBe('apple');
    expect(hard.rating).toBe(Rating.Hard);
    expect(hard.elapsedMs).toBe(2500);
    expect(hard.mode).toBe('learn');
    expect(hard.state).toBe(State.Review); // 新学即毕业
    expect(hard.scheduledDays).toBe(1); // 第一次复习在第二天
    expect(hard.reviewedAt).toBeGreaterThan(0);

    const again = logs[2];
    expect(again.rating).toBe(Rating.Again);
    expect(again.mode).toBe('review');
  });

  it('聚合正确性：多模式多评分累计到 daily_stats', async () => {
    await recordRating(WORDS[0], null, Rating.Good, 'learn', 1000); // learn, correct
    await recordRating(WORDS[1], null, Rating.Again, 'learn', 1000); // learn, wrong
    await recordRating(WORDS[2], null, Rating.Good, 'review', 1000); // review, correct

    const today = dateKey();
    const stat = await db.dailyStats.get(today);
    // 新学口径：Good(3) 计入，Again(1)=没学会 不计入
    expect(stat?.newCount).toBe(1);
    expect(stat?.reviewCount).toBe(1);
    expect(stat?.correctCount).toBe(2);
    expect(stat?.totalCount).toBe(3);
    expect(stat?.durationSec).toBeGreaterThanOrEqual(30); // 每题约 11 秒基线

    // getDailyStats 返回包含今天且合计正确
    const days = await getDailyStats(7);
    const last = days[days.length - 1];
    expect(last.date).toBe(today);
    expect(last.totalCount).toBe(3);
  });

  it('查询接口：近期日志 / 单词历史 / 薄弱词', async () => {
    await recordRating(WORDS[0], null, Rating.Again, 'learn', 1000);
    const appleCard = await db.userWords.get('apple');
    await recordRating(WORDS[0], appleCard ?? null, Rating.Good, 'review', 1000);
    await recordRating(WORDS[1], null, Rating.Again, 'learn', 1000);

    const recent = await getRecentLogs(7);
    expect(recent).toHaveLength(3);

    const wordLogs = await getLogsForWord('apple');
    expect(wordLogs).toHaveLength(2);
    expect(wordLogs[0].rating).toBe(Rating.Again);

    const weak = await getWeakWords(5);
    expect(weak.map((w) => w.wordId)).toEqual(expect.arrayContaining(['apple', 'banana']));
    expect(weak.find((w) => w.wordId === 'apple')?.wrongCount).toBe(1);
  });

  it('getRecentLogs 起始边界按东八区当天 00:00 计算（不随设备时区漂移）', async () => {
    // 东八区今天 00:00:00.000 整点——在非东八区设备上该时刻属于「昨天」
    const [tzMidnight] = dayRangeInZone(dateKey());
    await db.reviewLogs.add({
      wordId: 'apple',
      rating: Rating.Good,
      elapsedMs: 1000,
      reviewedAt: tzMidnight,
      scheduledDays: 0,
      state: State.Learning,
      mode: 'learn',
    });
    const recent = await getRecentLogs(1);
    expect(recent.some((l) => l.reviewedAt === tzMidnight)).toBe(true);
  });

  it('汇总与导出恢复往返', async () => {
    await recordRating(WORDS[0], null, Rating.Good, 'learn', 1000);
    await recordRating(WORDS[1], null, Rating.Again, 'review', 1000);

    const days = await getDailyStats(7);
    const summary = summarizeStats(days);
    expect(summary.totalNew).toBe(1);
    expect(summary.totalReview).toBe(1);
    expect(summary.totalAnswered).toBe(2);
    expect(summary.correctRate).toBe(50);
    expect(summary.activeDays).toBe(1);

    // 导出
    const json = await exportAllData();
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('wordmemory');
    expect(parsed.userWords).toHaveLength(2);
    expect(parsed.reviewLogs).toHaveLength(2);

    // 清空后恢复
    await resetDatabase();
    expect(await db.reviewLogs.count()).toBe(0);
    const restored = await restoreBackup(json);
    expect(restored.userWords).toHaveLength(2);
    expect(await db.reviewLogs.count()).toBe(2);
    expect(await db.userWords.count()).toBe(2);
  });
});
