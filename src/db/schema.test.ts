import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { installBookData, isBookInstalled, uninstallBook, getNewWordQueue, importCustomWords, parseCustomCsv, getCustomBooks } from '@/services/wordbook';
import { aggregateDailyStat, getDailyStats, getDueCount, getMasteryDistribution, ensureDailyStats } from '@/services/stats';
import { dateKey, dateKeyOffset } from '@/lib/format';
import type { UserWord } from '@/types';
import { FsrsState } from '@/types';

// 构造一个小型测试词库（模拟 public/dicts 结构）
const TEST_BOOK = {
  id: 'testbook',
  name: '测试词库',
  words: [
    { w: 'apple', uk: '/ˈæpl/', us: '/ˈæpl/', m: ['苹果'], pos: 'n.', ex: [], freq: 10, books: [] },
    { w: 'banana', uk: '/bəˈnɑːnə/', us: '/bəˈnænə/', m: ['香蕉'], pos: 'n.', ex: [], freq: 20, books: [] },
    { w: 'cherry', uk: '/ˈtʃeri/', us: '/ˈtʃeri/', m: ['樱桃'], pos: 'n.', ex: [], freq: 30, books: [] },
  ],
};

describe('数据层', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('安装词库：写入 words 并标记 books', async () => {
    const n = await installBookData('testbook', TEST_BOOK.words);
    expect(n).toBe(3);
    expect(await isBookInstalled('testbook')).toBe(true);
    const apple = await db.words.get('apple');
    expect(apple?.m).toEqual(['苹果']);
    expect(apple?.books).toContain('testbook');
    // 幂等：重复安装不重复写
    expect(await installBookData('testbook', TEST_BOOK.words)).toBe(3);
    expect(await db.words.count()).toBe(3);
  });

  it('新词队列：排除已学词并按词频排序', async () => {
    await db.words.bulkPut(TEST_BOOK.words.map((w) => ({ ...w, w: w.w, books: ['testbook'] })));
    await db.userWords.put({
      wordId: 'apple',
      bookIds: ['testbook'],
      due: 0,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 1,
      lapses: 0,
      state: FsrsState.Learning,
      learningSteps: 1,
      lastReviewAt: Date.now(),
      createdAt: Date.now(),
      wrongCount: 0,
      lastRating: null,
    } satisfies UserWord);
    const queue = await getNewWordQueue(['testbook'], 10);
    expect(queue.map((w) => w.w)).toEqual(['banana', 'cherry']); // 排除 apple，按 freq 升序
  });

  it('卸载词库：未被学习且无其他归属的词被删除', async () => {
    await db.words.bulkPut(TEST_BOOK.words.map((w) => ({ ...w, w: w.w, books: ['testbook'] })));
    await db.userWords.put({
      wordId: 'apple',
      bookIds: ['testbook'],
      due: 0,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 1,
      lapses: 0,
      state: FsrsState.Review,
      learningSteps: 0,
      lastReviewAt: Date.now(),
      createdAt: Date.now(),
      wrongCount: 0,
      lastRating: null,
    } satisfies UserWord);
    await uninstallBook('testbook');
    // apple 被学过 -> 保留但移除词库标记；banana/cherry 被删除
    expect(await db.words.get('apple')).toBeDefined();
    expect((await db.words.get('apple'))?.books).toEqual([]);
    expect(await db.words.get('banana')).toBeUndefined();
  });

  it('自定义导入：JSON 与 CSV 解析 + 合并更新', async () => {
    const csv = 'name,trans,usphone,ukphone,sentence,pos\n' +
      'apple,苹果,/ˈæpl/,,An apple a day.,n.\n' +
      'kiwi,猕猴桃,,,/kiːwiː/,n.\n';
    const words = parseCustomCsv(csv);
    expect(words).toHaveLength(2);
    expect(words[0].m).toEqual(['苹果']);
    const n = await importCustomWords(words);
    expect(n).toBe(2);
    const apple = await db.words.get('apple');
    expect(apple?.books).toContain('custom');
    // 再次导入更新释义
    await importCustomWords([{ ...words[0], m: ['苹果；苹果树'] }]);
    expect((await db.words.get('apple'))?.m).toEqual(['苹果；苹果树']);
  });

  it('CSV 解析：RFC 4180 双引号转义（"" 输出字面引号，释义不错位）', () => {
    // trans 含字面双引号：Excel/标准 CSV 用 "" 转义，字段整体用引号包裹
    const csv = 'name,trans,sentence\nquote,"he said ""hi""","She asked, ""really?"""\nplain,普通释义,\n';
    const words = parseCustomCsv(csv);
    expect(words).toHaveLength(2);
    expect(words[0].m).toEqual(['he said "hi"']); // 转义引号还原为字面引号
    expect(words[0].ex).toEqual(['She asked, "really?"']); // 引号内逗号不被拆列
    expect(words[1].m).toEqual(['普通释义']);
  });

  it('自定义导入：支持 freq 字段（CSV 列 / JSON 字段）', async () => {
    const csv = 'name,trans,freq\nfoo,释义一,5\nbar,释义二,\n';
    const fromCsv = parseCustomCsv(csv);
    expect(fromCsv[0].freq).toBe(5);
    expect(fromCsv[1].freq).toBeNull();
    // JSON 的 freq 字段由 parseCustomJson 透传（构造等价词条验证排序）
    const jsonWords = [
      { w: 'baz', uk: '', us: '', m: ['释义三'], pos: '', ex: [], freq: 3, books: [] },
    ];
    await importCustomWords([...fromCsv, ...jsonWords], 'custom:freq-test');
    const queue = await getNewWordQueue(['custom:freq-test'], 10);
    // freq 小的优先：baz(3) → foo(5) → bar(null)
    expect(queue.map((w) => w.w)).toEqual(['baz', 'foo', 'bar']);
  });

  it('多本自定义词书：同名追加、异名独立，可分别列出与启用', async () => {
    await importCustomWords(
      parseCustomCsv('name,trans\nterm1,术语一\nterm2,术语二\n'),
      'custom:专业术语',
    );
    // 同名词书第二批追加
    await importCustomWords(parseCustomCsv('name,trans\nterm3,术语三\n'), 'custom:专业术语');
    // 异名词书独立
    await importCustomWords(parseCustomCsv('name,trans\nperson1,人名一\n'), 'custom:人名表');

    const books = await getCustomBooks();
    const tech = books.find((b) => b.id === 'custom:专业术语');
    const names = books.find((b) => b.id === 'custom:人名表');
    expect(tech?.name).toBe('专业术语');
    expect(tech?.count).toBe(3); // 两批追加合并
    expect(names?.count).toBe(1);
    // 各自的队列互不干扰
    expect((await getNewWordQueue(['custom:专业术语'], 10)).map((w) => w.w)).toEqual(['term1', 'term2', 'term3']);
    expect((await getNewWordQueue(['custom:人名表'], 10)).map((w) => w.w)).toEqual(['person1']);
  });

  it('CSV 解析：剥离 UTF-8 BOM（Excel 导出兼容）', async () => {
    const csv = '\uFEFFname,trans\napple,苹果\nbanana,香蕉\n';
    const words = parseCustomCsv(csv);
    expect(words).toHaveLength(2);
    expect(words[0].w).toBe('apple');
    expect(words[0].m).toEqual(['苹果']);
  });

  it('多词库新词队列：各词库公平参与，全局按词频排序', async () => {
    // bookA 有 3 个低词频词（freq 大=不常用），bookB 有 1 个高频词
    await db.words.bulkPut([
      { w: 'aa', m: ['aa'], freq: 900, books: ['bookA'] },
      { w: 'bb', m: ['bb'], freq: 800, books: ['bookA'] },
      { w: 'cc', m: ['cc'], freq: 700, books: ['bookA'] },
      { w: 'zz', m: ['zz'], freq: 10, books: ['bookB'] },
    ]);
    const queue = await getNewWordQueue(['bookA', 'bookB'], 2);
    // 旧实现：bookA 词量 >= limit 直接 break，bookB 不参与 -> 只会出现 aa/bb
    // 新实现：合并候选后全局按词频排序 -> 高频词 zz 必进队列
    expect(queue.map((w) => w.w)).toEqual(['zz', 'cc']);
  });

  it('ensureDailyStats：缺失日期批量回填且保留已有时长', async () => {
    const today = dateKey();
    const d1 = dateKeyOffset(-1);
    const d2 = dateKeyOffset(-2);
    await db.reviewLogs.bulkAdd([
      { wordId: 'apple', rating: 3, elapsedMs: 1000, reviewedAt: new Date(`${d1}T12:00:00+08:00`).getTime(), scheduledDays: 1, state: FsrsState.Review, mode: 'review' },
      { wordId: 'banana', rating: 4, elapsedMs: 1000, reviewedAt: new Date(`${d2}T12:00:00+08:00`).getTime(), scheduledDays: 1, state: FsrsState.Review, mode: 'review' },
    ]);
    // 今天已有记录：验证回填不清除其时长
    await db.dailyStats.put({ date: today, newCount: 1, reviewCount: 0, correctCount: 1, totalCount: 1, durationSec: 42 });
    await ensureDailyStats(7);
    const stats = await getDailyStats(7);
    expect(stats[6].date).toBe(today);
    expect(stats[6].totalCount).toBe(1);
    expect(stats[6].durationSec).toBe(42); // 已有记录时长保留
    expect(stats[5].totalCount).toBe(1); // 昨天回填
    expect(stats[4].totalCount).toBe(1); // 前天回填
    expect(stats[5].durationSec).toBe(0);
  });

  it('统计聚合：重算与查询、掌握度分布', async () => {
    const today = dateKey();
    const now = new Date(`${today}T12:00:00+08:00`).getTime(); // 东八区今天正午，任何设备时区都落在今天区间内
    await db.reviewLogs.bulkAdd([
      { wordId: 'apple', rating: 3, elapsedMs: 2000, reviewedAt: now, scheduledDays: 1, state: FsrsState.Learning, mode: 'learn' },
      { wordId: 'banana', rating: 2, elapsedMs: 1500, reviewedAt: now, scheduledDays: 1, state: FsrsState.Learning, mode: 'review' },
      { wordId: 'cherry', rating: 4, elapsedMs: 1000, reviewedAt: now, scheduledDays: 3, state: FsrsState.Review, mode: 'review' },
    ]);
    await db.userWords.bulkPut([
      { wordId: 'apple', bookIds: [], due: now + 86400000, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, reps: 1, lapses: 0, state: FsrsState.Learning, learningSteps: 0, lastReviewAt: now, createdAt: now, wrongCount: 0, lastRating: 3 },
      { wordId: 'banana', bookIds: [], due: now + 86400000, stability: 2, difficulty: 5, elapsedDays: 1, scheduledDays: 1, reps: 2, lapses: 0, state: FsrsState.Review, learningSteps: 0, lastReviewAt: now, createdAt: now, wrongCount: 0, lastRating: 2 },
    ]);
    const stat = await aggregateDailyStat(today);
    expect(stat.newCount).toBe(1);
    expect(stat.reviewCount).toBe(2);
    expect(stat.correctCount).toBe(2); // rating 3 和 4
    expect(stat.totalCount).toBe(3);
    const days = await getDailyStats(7);
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe(today);
    expect(days[6].totalCount).toBe(3);
    expect(await getDueCount()).toBe(0);
    const dist = await getMasteryDistribution();
    expect(dist.reduce((s, d) => s + d.count, 0)).toBe(2);
  });
});
