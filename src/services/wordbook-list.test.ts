import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { installBookData, listWordsWithStatus } from '@/services/wordbook';
import type { UserWord } from '@/types';
import { FsrsState } from '@/types';

const TEST_BOOK = {
  id: 'testbook',
  name: '测试词库',
  words: [
    { w: 'apple', uk: '/ˈæpl/', us: '/ˈæpl/', m: ['苹果'], pos: 'n.', ex: [], freq: 10, books: [] },
    { w: 'banana', uk: '/bəˈnɑːnə/', us: '/bəˈnænə/', m: ['香蕉'], pos: 'n.', ex: [], freq: 20, books: [] },
    { w: 'cherry', uk: '/ˈtʃeri/', us: '/ˈtʃeri/', m: ['樱桃'], pos: 'n.', ex: [], freq: 30, books: [] },
  ],
};

const CUSTOM_BOOK = {
  id: 'custom:test',
  name: '自定义测试',
  words: [
    { w: 'apple', uk: '', us: '', m: ['苹果'], pos: 'n.', ex: [], freq: null, books: [] },
    { w: 'durian', uk: '', us: '', m: ['榴莲'], pos: 'n.', ex: [], freq: null, books: [] },
  ],
};

function makeCard(wordId: string, partial: Partial<UserWord> = {}): UserWord {
  const now = Date.now();
  return {
    wordId,
    bookIds: ['testbook'],
    due: now + 86400000,
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    state: FsrsState.Learning,
    learningSteps: 0,
    lastReviewAt: now,
    createdAt: now,
    wrongCount: 0,
    lastRating: 3,
    ...partial,
  };
}

describe('词表查询 listWordsWithStatus', () => {
  beforeEach(async () => {
    await resetDatabase();
    await installBookData('testbook', TEST_BOOK.words);
    await installBookData('custom:test', CUSTOM_BOOK.words);
  });

  it('词书筛选：只返回该词书的词（跨词书重复词按主键合并）', async () => {
    const list = await listWordsWithStatus({ bookId: 'testbook' });
    expect(list.map((i) => i.word.w).sort()).toEqual(['apple', 'banana', 'cherry']);
    const custom = await listWordsWithStatus({ bookId: 'custom:test' });
    expect(custom.map((i) => i.word.w).sort()).toEqual(['apple', 'durian']);
    // 全部（去重后）
    const all = await listWordsWithStatus();
    expect(all.map((i) => i.word.w).sort()).toEqual(['apple', 'banana', 'cherry', 'durian']);
  });

  it('状态筛选：未学 / 新学中 / 巩固中 / 已掌握 / 待复习', async () => {
    const now = Date.now();
    await db.userWords.bulkPut([
      makeCard('apple', { reps: 1, scheduledDays: 1 }), // 新学中
      makeCard('banana', { reps: 5, scheduledDays: 30, state: FsrsState.Review }), // 巩固中
      makeCard('cherry', { reps: 10, scheduledDays: 400, state: FsrsState.Review }), // 已掌握
    ]);

    expect((await listWordsWithStatus({ status: 'new' })).map((i) => i.word.w)).toEqual(['durian']);
    expect((await listWordsWithStatus({ status: 'learning' })).map((i) => i.word.w)).toEqual(['apple']);
    expect((await listWordsWithStatus({ status: 'consolidating' })).map((i) => i.word.w)).toEqual(['banana']);
    expect((await listWordsWithStatus({ status: 'mastered' })).map((i) => i.word.w)).toEqual(['cherry']);

    // 待复习：due <= now
    await db.userWords.put(makeCard('durian', { due: now - 1000, reps: 3, scheduledDays: 3, state: FsrsState.Review }));
    expect((await listWordsWithStatus({ status: 'due' })).map((i) => i.word.w)).toEqual(['durian']);
  });

  it('搜索：前缀匹配，且尊重词书/状态筛选', async () => {
    const byQuery = await listWordsWithStatus({ query: 'app' });
    expect(byQuery.map((i) => i.word.w)).toEqual(['apple']);
    // 搜索 + 词书筛选：apple 属于两本书，限定 custom:test 也能搜到
    const scoped = await listWordsWithStatus({ query: 'app', bookId: 'custom:test' });
    expect(scoped.map((i) => i.word.w)).toEqual(['apple']);
    // 搜索 + 状态：apple 未学
    const byStatus = await listWordsWithStatus({ query: 'app', status: 'new' });
    expect(byStatus.map((i) => i.word.w)).toEqual(['apple']);
  });

  it('排序：词频升序，未知词频（null）排最后', async () => {
    const list = await listWordsWithStatus();
    const freqOrder = list.map((i) => i.word.freq);
    expect(freqOrder).toEqual([10, 20, 30, null]);
  });
});
