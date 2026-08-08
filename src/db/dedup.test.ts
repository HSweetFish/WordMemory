import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import {
  installBookData,
  importCustomWords,
  getNewWordQueue,
  uninstallBook,
  parseCustomCsv,
} from '@/services/wordbook';
import { scheduler } from '@/fsrs/scheduler';

/**
 * 词库查重测试：words 表主键 = 小写单词，跨词库合并存储。
 * 覆盖两个用户关心场景：
 *  A. 导入词书与默认词库有重复词 → 合并不重复，books 双标记，释义取新导入
 *  B. 已背过的词出现在新导入词书中 → 不重复学习，学习进度保留
 */

// 模拟内置默认词库（public/dicts 结构）
const DEFAULT_BOOK = {
  id: 'cet4',
  words: [
    { w: 'apple', uk: '/ˈæpl/', us: '/ˈæpl/', m: ['苹果'], pos: 'n.', ex: [], freq: 10, books: [] },
    { w: 'banana', uk: '/bəˈnɑːnə/', us: '/bəˈnænə/', m: ['香蕉'], pos: 'n.', ex: [], freq: 20, books: [] },
  ],
};

describe('词库查重', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('场景A：导入词书与默认词库有重复词——合并为一条，books 双标记，释义取新导入', async () => {
    await installBookData('cet4', DEFAULT_BOOK.words);
    // 导入一本含 apple（重复）+ kiwi（新词）的自定义词书
    await importCustomWords(
      parseCustomCsv('name,trans\napple,苹果；苹果树\nkiwi,猕猴桃\n'),
      'custom:考试词表',
    );

    // words 表只有 3 条：apple/banana/kiwi，不产生重复词条
    expect(await db.words.count()).toBe(3);
    const apple = await db.words.get('apple');
    expect(apple?.books).toEqual(expect.arrayContaining(['cet4', 'custom:考试词表']));
    // 自定义导入新数据优先：释义被新词书覆盖（CSV 中「；」分隔的释义拆成数组元素）
    expect(apple?.m).toEqual(['苹果', '苹果树']);

    // 队列视角：两本词库都启用时，apple 只出现一次（seen 集合去重）
    const queue = await getNewWordQueue(['cet4', 'custom:考试词表'], 10);
    expect(queue.filter((w) => w.w === 'apple')).toHaveLength(1);
  });

  it('场景B：已背过的词出现在新导入词书中——不重复学习，进度保留', async () => {
    // 第一本自定义词书：学 apple
    await importCustomWords(parseCustomCsv('name,trans\napple,苹果\n'), 'custom:第一本');
    const card = scheduler.createCard('apple', ['custom:第一本']);
    await db.userWords.put(card);

    // 第二本词书：含重复词 apple + 新词 pear
    await importCustomWords(parseCustomCsv('name,trans\napple,苹果\npear,梨\n'), 'custom:第二本');

    // words 表不重复（apple/pear 两条）
    expect(await db.words.count()).toBe(2);
    expect((await db.words.get('apple'))?.books).toEqual(
      expect.arrayContaining(['custom:第一本', 'custom:第二本']),
    );

    // 学习进度（FSRS 卡片）原样保留：importCustomWords 只写 words 表，不碰 userWords
    expect(await db.userWords.get('apple')).toEqual(card);

    // 新学队列：apple 已学过不再出现，第二本只有 pear 可学
    const queue = await getNewWordQueue(['custom:第二本'], 10);
    expect(queue.map((w) => w.w)).toEqual(['pear']);

    // 已知行为：卡片上的 bookIds 是创建时的快照，导入新词书不追溯更新
    // （仪表盘「按词库学习进度」会把 apple 记在第一本名下）
    expect((await db.userWords.get('apple'))?.bookIds).toEqual(['custom:第一本']);
  });

  it('镜像场景：卸载含重复词的词书——已学词保留，仅移除该词库标记', async () => {
    await installBookData('cet4', DEFAULT_BOOK.words);
    await importCustomWords(parseCustomCsv('name,trans\napple,苹果；苹果树\n'), 'custom:考试词表');
    // 学 apple（归属快照含两个词库）
    await db.userWords.put(scheduler.createCard('apple', ['cet4', 'custom:考试词表']));

    await uninstallBook('custom:考试词表');

    // apple 被学过且仍在 cet4 → 保留，移除 custom 标记
    const apple = await db.words.get('apple');
    expect(apple).toBeDefined();
    expect(apple?.books).toEqual(['cet4']);
    // kiwi 未被学且只属于被卸载词书 → 删除
    expect(await db.words.get('kiwi')).toBeUndefined();
    // banana 只属于 cet4，与本次卸载无关 → 保留
    expect(await db.words.get('banana')).toBeDefined();
    // 学习进度不受卸载影响
    expect(await db.userWords.get('apple')).toBeDefined();
  });
});
