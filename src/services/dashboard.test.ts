import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { installBookData } from '@/services/wordbook';
import { recordRating } from '@/services/study';
import { useSettings } from '@/stores/settings';
import { Rating, State } from '@/types';
import {
  getHeatmapData,
  getTrendData,
  getMasteryData,
  getForgettingCurveData,
  getBookProgress,
  getWeakWordData,
  getPosDistribution,
  getDashboardSummary,
  heatmapRange,
} from '@/services/dashboard';
import { dateKeyOffset } from '@/lib/format';

const WORDS = [
  { w: 'apple', uk: '', us: '', m: ['苹果'], pos: 'n.', ex: [], freq: 10, books: [] },
  { w: 'banana', uk: '', us: '', m: ['香蕉'], pos: 'n.', ex: [], freq: 20, books: [] },
  { w: 'cherry', uk: '', us: '', m: ['樱桃'], pos: 'n.', ex: [], freq: 30, books: [] },
  { w: 'happy', uk: '', us: '', m: ['快乐的'], pos: 'adj.', ex: [], freq: 40, books: [] },
  { w: 'quickly', uk: '', us: '', m: ['快速地'], pos: 'adv.', ex: [], freq: 50, books: [] },
];

describe('仪表盘数据服务', () => {
  beforeEach(async () => {
    await resetDatabase();
    useSettings.getState().set({ activeBooks: ['testbook'] });
    await installBookData('testbook', WORDS);
  });

  it('汇总卡片与热力图/趋势数据', async () => {
    await recordRating(WORDS[0], null, Rating.Good, 'learn', 1000);
    await recordRating(WORDS[1], null, Rating.Again, 'learn', 1000);
    await recordRating(WORDS[2], null, Rating.Good, 'review', 1000);

    const summary = await getDashboardSummary();
    expect(summary.learnedWords).toBe(3);
    expect(summary.totalLogs).toBe(3);
    expect(summary.todayReview).toBe(1);

    const heatmap = await getHeatmapData();
    // 固定 12 个完整自然周（周一起点，不随今天漂移）
    expect(heatmap).toHaveLength(12 * 7);
    expect(heatmap[0].date).toBe(heatmapRange()[0]);
    expect(heatmap[heatmap.length - 1].date).toBe(heatmapRange()[1]);
    // 热力图口径 = 新学单词数 + 复习单词数（答 3 次：apple 新学 1 + cherry 复习 1；banana 没学会不计）
    const todayPoint = heatmap.find((h) => h.date === dateKeyOffset(0));
    expect(todayPoint?.count).toBe(2);
    // 分量：新学 1、复习 1，供「全部 / 新学 / 复习」切换展示
    expect(todayPoint?.newCount).toBe(1);
    expect(todayPoint?.reviewCount).toBe(1);

    const trend = await getTrendData(30);
    expect(trend).toHaveLength(30);
    const today = trend[trend.length - 1];
    // 新学口径：Good(3) 计入，Again(1)=没学会 不计入
    expect(today.learn).toBe(1);
    expect(today.review).toBe(1);
    expect(today.correctRate).toBe(67);
  });

  it('掌握度分布与词库进度', async () => {
    // apple 连点「很熟练」复习到间隔 ≥ 365 天 → 已掌握
    // 注：测试是连续立即复习（elapsed=0），FSRS 间隔增长远慢于真实按到期复习，
    // 故放宽循环上限；真实使用时按时到期复习约 6 次即达 365 天以上
    await recordRating(WORDS[0], null, Rating.Easy, 'learn', 1000);
    let card = await db.userWords.get('apple');
    for (let i = 0; i < 30 && card && card.scheduledDays < 365; i++) {
      await recordRating(WORDS[0], card, Rating.Easy, 'review', 1000);
      card = await db.userWords.get('apple');
    }
    // banana 只学一次（间隔 1 天）→ 新学中
    await recordRating(WORDS[1], null, Rating.Good, 'learn', 1000);

    const mastery = await getMasteryData();
    const freshSlice = mastery.find((m) => m.name === '新学中');
    expect(freshSlice?.value).toBe(1); // banana 间隔 1 天
    const masteredSlice = mastery.find((m) => m.name === '已掌握');
    expect(masteredSlice?.value).toBeGreaterThanOrEqual(1); // apple 间隔 ≥ 365
    const notLearnedSlice = mastery.find((m) => m.name === '未学习');
    expect(notLearnedSlice?.value).toBe(3);

    const books = await getBookProgress([{ id: 'testbook', name: '测试词库', desc: '', count: 5, file: '' }]);
    expect(books.length).toBeGreaterThan(0);
    const test = books.find((b) => b.id === 'testbook');
    expect(test?.total).toBe(5);
    expect(test?.learned).toBeGreaterThanOrEqual(1);
  });

  it('薄弱词与词性分布', async () => {
    await recordRating(WORDS[0], null, Rating.Again, 'learn', 1000);
    const appleCard = await db.userWords.get('apple');
    await recordRating(WORDS[0], appleCard ?? null, Rating.Again, 'learn', 1000); // apple 累计错 2 次
    await recordRating(WORDS[1], null, Rating.Again, 'learn', 1000);
    await recordRating(WORDS[2], null, Rating.Good, 'learn', 1000);
    await recordRating(WORDS[3], null, Rating.Good, 'learn', 1000);
    await recordRating(WORDS[4], null, Rating.Good, 'learn', 1000);

    const weak = await getWeakWordData(10);
    expect(weak[0].name).toBe('apple');
    expect(weak[0].wrongCount).toBe(2);

    const pos = await getPosDistribution();
    expect(pos.find((p) => p.name === '名词')?.value).toBe(3);
    expect(pos.find((p) => p.name === '形容词')?.value).toBe(1);
    expect(pos.find((p) => p.name === '副词')?.value).toBe(1);
  });

  it('薄弱词：回忆确认删卡重建后，历史答错次数不丢失', async () => {
    // 模拟学习流程：学 apple 答错 3 次（卡片 wrongCount=3）
    for (let i = 0; i < 3; i++) {
      const card = await db.userWords.get('apple');
      await recordRating(WORDS[0], card ?? null, Rating.Again, 'learn', 1000);
    }
    expect((await db.userWords.get('apple'))?.wrongCount).toBe(3);
    // 回忆确认记错 → resetWordLearning 删卡（卡片 wrongCount 清零）
    await db.userWords.delete('apple');
    // 薄弱词仍按日志统计出 3 次答错
    const weak = await getWeakWordData(10);
    expect(weak.find((w) => w.name === 'apple')?.wrongCount).toBe(3);
  });

  it('薄弱词：Hard(模糊) 与 Again(没记住) 都计入，明细分开', async () => {
    // apple：Again 1 次 + Hard 1 次 → 薄弱 2 次；banana：仅 Hard 1 次 → 薄弱 1 次
    await recordRating(WORDS[0], null, Rating.Again, 'learn', 1000);
    const appleCard = await db.userWords.get('apple');
    await recordRating(WORDS[0], appleCard ?? null, Rating.Hard, 'review', 1000);
    await recordRating(WORDS[1], null, Rating.Hard, 'learn', 1000);

    const weak = await getWeakWordData(10);
    const apple = weak.find((w) => w.name === 'apple');
    expect(apple?.wrongCount).toBe(2);
    expect(apple?.againCount).toBe(1);
    expect(apple?.hardCount).toBe(1);
    const banana = weak.find((w) => w.name === 'banana');
    expect(banana?.wrongCount).toBe(1);
    expect(banana?.againCount).toBe(0);
    expect(banana?.hardCount).toBe(1);
    // 同分时 Again 更多的排前面（apple 2 次 > banana 1 次，顺序必然 apple 在前）
    expect(weak[0].name).toBe('apple');
  });

  it('词性分布：多词性词条按词性拆分计数，未识别类别归入「其他」', async () => {
    await installBookData('multi', [
      { w: 'record', uk: '', us: '', m: ['记录', '录制'], pos: 'n.；vt.', ex: [], freq: 60, books: [] },
      { w: 'gps', uk: '', us: '', m: ['全球定位系统'], pos: 'abbr.', ex: [], freq: 70, books: [] },
    ]);
    await recordRating({ ...WORDS[0], w: 'record' }, null, Rating.Good, 'learn', 1000);
    await recordRating({ ...WORDS[0], w: 'gps' }, null, Rating.Good, 'learn', 1000);

    const pos = await getPosDistribution();
    expect(pos.find((p) => p.name === '名词')?.value).toBe(1);
    expect(pos.find((p) => p.name === '及物动词')?.value).toBe(1);
    // abbr. 未在展示类别中 → 归入「其他」
    const other = pos.find((p) => p.name === '其他');
    expect(other?.value).toBe(1);
    // 「其他」排在最后
    expect(pos[pos.length - 1].name).toBe('其他');
  });

  it('遗忘曲线：有稳定性时返回理论曲线', async () => {
    await recordRating(WORDS[0], null, Rating.Good, 'learn', 1000);
    const curve = await getForgettingCurveData();
    // 学习中的卡片也有稳定性（FSRS 首次复习后即计算）
    expect(curve.theoretical.length).toBeGreaterThan(0);
    expect(curve.avgStability).toBeGreaterThan(0);
  });

  it('保持率曲线：同天学习/重学不产生数据，跨天复习通过计入保持', async () => {
    const now = Date.now();
    // 同一词两条同一天日志（学习 + 几分钟后重学）→ 观察期不足 1 天，不进入曲线
    await db.reviewLogs.add({ wordId: 'apple', rating: 3, elapsedMs: 1000, reviewedAt: now - 300000, scheduledDays: 1, state: State.Review, mode: 'learn' });
    await db.reviewLogs.add({ wordId: 'apple', rating: 3, elapsedMs: 1000, reviewedAt: now, scheduledDays: 1, state: State.Review, mode: 'learn' });
    const curve1 = await getForgettingCurveData();
    expect(curve1.actual).toHaveLength(0);

    // 两个词 2 天前学习 → 今天复习通过（3/4）→ 从未失败，第 1、2 天保持率 100%
    await db.reviewLogs.add({ wordId: 'banana', rating: 3, elapsedMs: 1000, reviewedAt: now - 86400000 * 2, scheduledDays: 1, state: State.Review, mode: 'learn' });
    await db.reviewLogs.add({ wordId: 'banana', rating: 4, elapsedMs: 1000, reviewedAt: now, scheduledDays: 1, state: State.Review, mode: 'review' });
    await db.reviewLogs.add({ wordId: 'cherry', rating: 3, elapsedMs: 1000, reviewedAt: now - 86400000 * 2, scheduledDays: 1, state: State.Review, mode: 'learn' });
    await db.reviewLogs.add({ wordId: 'cherry', rating: 3, elapsedMs: 1000, reviewedAt: now, scheduledDays: 1, state: State.Review, mode: 'review' });
    const curve2 = await getForgettingCurveData();
    expect(curve2.actual.length).toBeGreaterThan(0);
    expect(curve2.actual[0].days).toBe(1);
    expect(curve2.actual[0].successRate).toBe(100);
    expect(curve2.actual[0].samples).toBe(2);
    // 第 2 天仍未失败 → 保持率继续 100%
    const d2 = curve2.actual.find((p) => p.days === 2);
    expect(d2?.successRate).toBe(100);
    expect(d2?.samples).toBe(2);
  });

  it('保持率曲线：复习评 1-2 档判定为遗忘，从失败日起退出保持', async () => {
    const now = Date.now();
    // 两个词 2 天前学习(Good)，今天复习都点 Hard(2) → 首败发生在第 2 天
    await db.reviewLogs.add({ wordId: 'apple', rating: 3, elapsedMs: 1000, reviewedAt: now - 86400000 * 2, scheduledDays: 1, state: State.Review, mode: 'learn' });
    await db.reviewLogs.add({ wordId: 'apple', rating: 2, elapsedMs: 1000, reviewedAt: now, scheduledDays: 2, state: State.Review, mode: 'review' });
    await db.reviewLogs.add({ wordId: 'banana', rating: 3, elapsedMs: 1000, reviewedAt: now - 86400000 * 2, scheduledDays: 1, state: State.Review, mode: 'learn' });
    await db.reviewLogs.add({ wordId: 'banana', rating: 2, elapsedMs: 1000, reviewedAt: now, scheduledDays: 2, state: State.Review, mode: 'review' });
    const curve = await getForgettingCurveData();
    // 第 1 天：两词都还没失败 → 100%
    const d1 = curve.actual.find((p) => p.days === 1);
    expect(d1?.successRate).toBe(100);
    expect(d1?.samples).toBe(2);
    // 第 2 天：2/2 失败 → 保持率降到 0%
    const d2 = curve.actual.find((p) => p.days === 2);
    expect(d2).toBeDefined();
    expect(d2?.successRate).toBe(0);
    expect(d2?.samples).toBe(2);
  });

  it('保持率曲线：记忆单调假设——后几天记住的词，前几天也计入保持（日历日差）', async () => {
    // 8/9 21:47 学、8/11 21:52 复习通过：日历日差 2 天（时间差 ceil 会是 3 天）
    const t0 = Date.UTC(2026, 7, 9, 13, 47); // 东八区 21:47
    const t1 = Date.UTC(2026, 7, 11, 13, 52); // 东八区 21:52
    await db.reviewLogs.add({ wordId: 'apple', rating: 3, elapsedMs: 1000, reviewedAt: t0, scheduledDays: 1, state: State.Review, mode: 'learn' });
    await db.reviewLogs.add({ wordId: 'apple', rating: 3, elapsedMs: 1000, reviewedAt: t1, scheduledDays: 2, state: State.Review, mode: 'review' });
    await db.reviewLogs.add({ wordId: 'banana', rating: 3, elapsedMs: 1000, reviewedAt: t0, scheduledDays: 1, state: State.Review, mode: 'learn' });
    await db.reviewLogs.add({ wordId: 'banana', rating: 3, elapsedMs: 1000, reviewedAt: t1, scheduledDays: 2, state: State.Review, mode: 'review' });
    const curve = await getForgettingCurveData();
    // 两词 8/9 学、8/11 复习通过 → 从未失败：观察期内每天都 100% 保持（样本 2）
    expect(curve.actual[0].days).toBe(1);
    expect(curve.actual.every((p) => p.successRate === 100)).toBe(true);
    expect(curve.actual[0].samples).toBe(2);
  });
});
