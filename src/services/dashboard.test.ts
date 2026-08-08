import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { installBookData } from '@/services/wordbook';
import { recordRating } from '@/services/study';
import { useSettings } from '@/stores/settings';
import { Rating } from '@/types';
import {
  getHeatmapData,
  getTrendData,
  getMasteryData,
  getForgettingCurveData,
  getBookProgress,
  getWeakWordData,
  getPosDistribution,
  getDashboardSummary,
} from '@/services/dashboard';

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
    expect(heatmap).toHaveLength(26 * 7);
    const last = heatmap[heatmap.length - 1];
    expect(last.count).toBe(3);

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
});
