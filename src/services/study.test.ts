import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { installBookData } from '@/services/wordbook';
import { loadLearnQueue, loadReviewQueue, loadRandomQueue, recordRating, resetWordLearning, migrateLegacyFirstReviewDue } from '@/services/study';
import { getTodayNewCount } from '@/services/stats';
import { useSettings } from '@/stores/settings';
import { dateKey, dayRangeInZone } from '@/lib/format';
import { Rating, State } from '@/types';

const TEST_BOOK = {
  id: 'testbook',
  name: '测试词库',
  words: [
    { w: 'apple', uk: '/ˈæpl/', us: '/ˈæpl/', m: ['苹果'], pos: 'n.', ex: [], freq: 10, books: [] },
    { w: 'banana', uk: '/bəˈnɑːnə/', us: '/bəˈnænə/', m: ['香蕉'], pos: 'n.', ex: [], freq: 20, books: [] },
    { w: 'cherry', uk: '/ˈtʃeri/', us: '/ˈtʃeri/', m: ['樱桃'], pos: 'n.', ex: [], freq: 30, books: [] },
    { w: 'date', uk: '/deɪt/', us: '/deɪt/', m: ['日期；枣'], pos: 'n.', ex: [], freq: 40, books: [] },
    { w: 'elder', uk: '/ˈeldə/', us: '/ˈeldər/', m: ['年长的'], pos: 'adj.', ex: [], freq: 50, books: [] },
  ],
};

describe('学习闭环（学习服务 + 会话落库）', () => {
  beforeEach(async () => {
    await resetDatabase();
    useSettings.getState().set({ activeBooks: ['testbook'], dailyNewLimit: 3, dailyReviewLimit: 100 });
    await installBookData('testbook', TEST_BOOK.words);
  });

  it('学习队列：按每日上限截取新词，已学词不重复出现', async () => {
    const queue = await loadLearnQueue();
    expect(queue.map((w) => w.w)).toEqual(['apple', 'banana', 'cherry']); // 前 3 个高频词
    // 学完一个词后队列不再包含它
    const apple = TEST_BOOK.words[0];
    await recordRating(apple, null, Rating.Good, 'learn', 5000);
    const queue2 = await loadLearnQueue();
    expect(queue2.map((w) => w.w)).toEqual(['banana', 'cherry']);
  });

  it('学习队列：按每组数量分批，不突破每日上限', async () => {
    // 每日上限 3、每组 2 → 第一批 2 个，第二批 1 个，之后为空
    useSettings.getState().set({ groupSize: 2 });
    const q1 = await loadLearnQueue();
    expect(q1.map((w) => w.w)).toEqual(['apple', 'banana']);
    await recordRating(TEST_BOOK.words[0], null, Rating.Good, 'learn', 5000);
    await recordRating(TEST_BOOK.words[1], null, Rating.Good, 'learn', 5000);
    const q2 = await loadLearnQueue();
    expect(q2.map((w) => w.w)).toEqual(['cherry']); // 剩余配额 1 < 每组 2
    await recordRating(TEST_BOOK.words[2], null, Rating.Good, 'learn', 5000);
    const q3 = await loadLearnQueue();
    expect(q3).toEqual([]); // 每日配额 3 用完
  });

  it('评分落库：user_words + review_logs + daily_stats 全部更新', async () => {
    const apple = TEST_BOOK.words[0];
    const { updated, log } = await recordRating(apple, null, Rating.Good, 'learn', 4200);
    expect(updated.state).toBe(State.Review); // 新学即毕业，第一次复习在第二天
    expect(log.mode).toBe('learn');
    expect(log.rating).toBe(Rating.Good);
    // user_words
    const card = await db.userWords.get('apple');
    expect(card?.reps).toBe(1);
    expect(card?.lastRating).toBe(Rating.Good);
    // review_logs
    const logs = await db.reviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].elapsedMs).toBe(4200);
    // daily_stats
    const today = dateKey();
    const stat = await db.dailyStats.get(today);
    expect(stat?.newCount).toBe(1);
    expect(stat?.totalCount).toBe(1);
    expect(stat?.correctCount).toBe(1);
  });

  it('新学计数：同一词回炉多次只计一次今日新学', async () => {
    const apple = TEST_BOOK.words[0];
    // 首次学习（建卡）→ 计入新学
    await recordRating(apple, null, Rating.Good, 'learn', 3000);
    // 回炉（已有卡片再次学习）→ 答题流水照记，但新学数不再 +1
    const existing = await db.userWords.get('apple');
    await recordRating(apple, existing ?? null, Rating.Hard, 'learn', 2500);
    await recordRating(apple, (await db.userWords.get('apple')) ?? null, Rating.Good, 'learn', 2000);
    const today = dateKey();
    const stat = await db.dailyStats.get(today);
    expect(stat?.newCount).toBe(1); // 回炉不重复计
    expect(stat?.totalCount).toBe(3); // 流水仍按答题次数计
    expect(await getTodayNewCount()).toBe(1); // 今日新学按词去重
  });

  it('复习队列：到期词按 due 排序，未到期不出现', async () => {
    const now = Date.now();
    // 直接构造两张卡片：一张已到期，一张未到期
    await db.userWords.bulkPut([
      {
        wordId: 'apple', bookIds: ['testbook'], due: now - 1000, stability: 2, difficulty: 5,
        elapsedDays: 1, scheduledDays: 1, reps: 2, lapses: 0, state: State.Review,
        learningSteps: 0, lastReviewAt: now - 86400000, createdAt: now, wrongCount: 0, lastRating: 3,
      },
      {
        wordId: 'banana', bookIds: ['testbook'], due: now + 86400000, stability: 2, difficulty: 5,
        elapsedDays: 0, scheduledDays: 1, reps: 2, lapses: 0, state: State.Review,
        learningSteps: 0, lastReviewAt: now, createdAt: now, wrongCount: 0, lastRating: 3,
      },
    ]);
    const queue = await loadReviewQueue(10);
    expect(queue.map((it) => it.word.w)).toEqual(['apple']);
    expect(queue[0].userWord.wordId).toBe('apple');
  });

  /** 构造一张已到期的复习卡 */
  function dueCard(wordId: string, due: number) {
    return {
      wordId, bookIds: ['testbook'], due, stability: 2, difficulty: 5,
      elapsedDays: 1, scheduledDays: 1, reps: 2, lapses: 0, state: State.Review,
      learningSteps: 0, lastReviewAt: due - 86400000, createdAt: due - 86400000, wrongCount: 0, lastRating: 3,
    };
  }

  it('复习队列：严格受每日复习上限截取', async () => {
    const now = Date.now();
    await db.userWords.bulkPut([dueCard('apple', now - 3000), dueCard('banana', now - 2000), dueCard('cherry', now - 1000)]);
    useSettings.getState().set({ dailyReviewLimit: 2 });
    const queue = await loadReviewQueue();
    expect(queue.map((it) => it.word.w)).toEqual(['apple', 'banana']);
  });

  it('复习队列：今日已复习数扣减每日配额', async () => {
    const now = Date.now();
    await db.userWords.bulkPut([dueCard('apple', now - 3000), dueCard('banana', now - 2000)]);
    useSettings.getState().set({ dailyReviewLimit: 2 });
    // 先复习 1 个（写入 mode=review 日志）
    const existing = await db.userWords.get('apple');
    await recordRating(TEST_BOOK.words[0], existing ?? null, Rating.Good, 'review', 3000);
    // apple 的 due 已被排到未来，剩余每日配额 1 → 只剩 banana
    const queue = await loadReviewQueue();
    expect(queue.map((it) => it.word.w)).toEqual(['banana']);
  });

  it('复习队列：每日上限为 0 时关闭复习', async () => {
    const now = Date.now();
    await db.userWords.bulkPut([dueCard('apple', now - 1000)]);
    useSettings.getState().set({ dailyReviewLimit: 0 });
    expect(await loadReviewQueue()).toEqual([]);
  });

  it('复习队列：显式 limit 不突破每日配额', async () => {
    const now = Date.now();
    await db.userWords.bulkPut([dueCard('apple', now - 3000), dueCard('banana', now - 2000), dueCard('cherry', now - 1000)]);
    useSettings.getState().set({ dailyReviewLimit: 2 });
    const queue = await loadReviewQueue(100);
    expect(queue).toHaveLength(2);
  });

  it('复习队列：答错不消耗每日配额，当天可再复习', async () => {
    const now = Date.now();
    // 只有 1 个配额，但有 2 张到期卡
    await db.userWords.bulkPut([dueCard('apple', now - 3000), dueCard('banana', now - 2000)]);
    useSettings.getState().set({ dailyReviewLimit: 1 });
    // 复习 apple 答错（Again）→ 不消耗配额
    const existing = await db.userWords.get('apple');
    await recordRating(TEST_BOOK.words[0], existing ?? null, Rating.Again, 'review', 3000);
    // 配额仍剩 1 → banana（若 apple 回炉 due 很近则也可能在列）必然可继续复习
    const queue = await loadReviewQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.map((it) => it.word.w)).toContain('banana');
  });

  it('复习队列：答对消耗每日配额（对照）', async () => {
    const now = Date.now();
    await db.userWords.bulkPut([dueCard('apple', now - 3000), dueCard('banana', now - 2000)]);
    useSettings.getState().set({ dailyReviewLimit: 1 });
    // 复习 apple 答对（Good）→ 消耗配额
    const existing = await db.userWords.get('apple');
    await recordRating(TEST_BOOK.words[0], existing ?? null, Rating.Good, 'review', 3000);
    // 配额已用完 → 无剩余可复习
    const queue = await loadReviewQueue();
    expect(queue).toEqual([]);
  });

  it('复习评分：学习模式与复习模式分开计数', async () => {
    const now = Date.now();
    await db.userWords.put({
      wordId: 'apple', bookIds: ['testbook'], due: now - 1000, stability: 2, difficulty: 5,
      elapsedDays: 1, scheduledDays: 1, reps: 2, lapses: 0, state: State.Review,
      learningSteps: 0, lastReviewAt: now - 86400000, createdAt: now, wrongCount: 0, lastRating: 3,
    });
    const apple = TEST_BOOK.words[0];
    const existing = await db.userWords.get('apple');
    await recordRating(apple, existing ?? null, Rating.Again, 'review', 3000);
    const today = dateKey();
    const stat = await db.dailyStats.get(today);
    expect(stat?.reviewCount).toBe(1);
    expect(stat?.newCount).toBe(0);
    expect(stat?.correctCount).toBe(0); // Again 不算正确
    const updated = await db.userWords.get('apple');
    expect(updated?.wrongCount).toBe(1); // 答错累计
    // relearning_steps=['1d'] 属长期步骤：卡片直接排到第二天（不再 10 分钟循环）
    expect(updated?.due).toBeGreaterThan(Date.now() + 86_000_000);
  });

  it('随机抽查：只抽已毕业卡片（排除学习中），不受到期限制', async () => {
    const now = Date.now();
    // 两张已毕业（Review）+ 一张学习中（Learning）
    await db.userWords.bulkPut([
      dueCard('apple', now + 86400000 * 30), // 未到期也能被抽查
      dueCard('banana', now - 1000),
      { ...dueCard('cherry', now - 1000), state: State.Learning, reps: 1 },
    ]);
    const queue = await loadRandomQueue(10);
    expect(queue).toHaveLength(2); // cherry 被排除
    expect(queue.map((it) => it.word.w).sort()).toEqual(['apple', 'banana']);
  });

  it('随机抽查：不消耗每日复习配额', async () => {
    const now = Date.now();
    await db.userWords.bulkPut([dueCard('apple', now - 1000), dueCard('banana', now - 2000)]);
    useSettings.getState().set({ dailyReviewLimit: 1 });
    // 抽查 apple 答对（mode=random）
    const existing = await db.userWords.get('apple');
    await recordRating(TEST_BOOK.words[0], existing ?? null, Rating.Good, 'random', 3000);
    // 抽查不占配额 → 到期队列仍能拿到 banana
    const queue = await loadReviewQueue();
    expect(queue.map((it) => it.word.w)).toEqual(['banana']);
  });

  it('回忆失败重置：删除学习记录重新来过，历史日志保留、新学计数不虚高', async () => {
    // 先正常学一个词（产生卡片 + 日志）
    const apple = TEST_BOOK.words[0];
    await recordRating(apple, null, Rating.Good, 'learn', 5000);
    expect(await db.userWords.get('apple')).toBeDefined();
    expect(await getTodayNewCount()).toBe(1);

    // 回忆失败 → 重置：删卡
    const ok = await resetWordLearning('apple');
    expect(ok).toBe(true);
    expect(await db.userWords.get('apple')).toBeUndefined(); // 卡片已删除

    // 答题历史保留（记忆历史可回看）
    const logs = await db.reviewLogs.where('wordId').equals('apple').toArray();
    expect(logs.length).toBe(1);

    // 重新学习 → 重新建卡；今日新学计数按词去重，仍为 1（不虚高）
    await recordRating(apple, null, Rating.Good, 'learn', 5000);
    expect(await db.userWords.get('apple')).toBeDefined();
    expect(await getTodayNewCount()).toBe(1);
    // daily_stats 增量缓存（热力图/趋势图口径）也不虚高：重置后重学不再重复计新学
    const stat = await db.dailyStats.get(dateKey());
    expect(stat?.newCount).toBe(1);
  });

  it('迁移：旧版「24 小时后」首次复习提前到今天 0 点，今天刚学的不动', async () => {
    const todayStart = dayRangeInZone(dateKey())[0];
    // 昨晚 21 点学的新词（旧算法排到今晚 21 点到期）→ 应提前到今天 0 点
    const yesterdayEvening = todayStart - 3 * 3600 * 1000;
    await db.userWords.put({
      ...dueCard('apple', yesterdayEvening + 86400000),
      reps: 1, lastReviewAt: yesterdayEvening, scheduledDays: 1,
    });
    // 今天刚学的词（旧算法 due=明天此刻）→ 不应被迁移（间隔才几小时，不能今天复习）
    const now = Date.now();
    await db.userWords.put({
      ...dueCard('banana', now + 86400000),
      reps: 1, lastReviewAt: now, scheduledDays: 1,
    });
    const n = await migrateLegacyFirstReviewDue();
    expect(n).toBe(1);
    const apple = await db.userWords.get('apple');
    expect(apple?.due).toBe(todayStart); // 提前到今天 0 点 → 今天即可复习
    const banana = await db.userWords.get('banana');
    expect(banana?.due).toBe(now + 86400000); // 不受影响
  });
});
