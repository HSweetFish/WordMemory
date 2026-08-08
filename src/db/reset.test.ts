import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase, clearLearningProgress, resetAllData } from '@/db/schema';
import { installBookData, getLearnedWordIds } from '@/services/wordbook';
import { recordRating } from '@/services/study';
import { useSettings, DEFAULT_SETTINGS } from '@/stores/settings';
import { Rating } from '@/types';

const WORDS = [
  { w: 'apple', uk: '', us: '', m: ['苹果'], pos: 'n.', ex: [], freq: 10, books: [] },
  { w: 'banana', uk: '', us: '', m: ['香蕉'], pos: 'n.', ex: [], freq: 20, books: [] },
  { w: 'cherry', uk: '', us: '', m: ['樱桃'], pos: 'n.', ex: [], freq: 30, books: [] },
];

describe('数据库重置', () => {
  beforeEach(async () => {
    await resetDatabase();
    useSettings.getState().set({ activeBooks: ['testbook'] });
    await installBookData('testbook', WORDS);
  });

  it('clearLearningProgress：清空学习进度但保留词库，已学缓存同步失效', async () => {
    await recordRating(WORDS[0], null, Rating.Good, 'learn', 1000);
    await recordRating(WORDS[1], null, Rating.Again, 'learn', 1000);
    expect(await db.userWords.count()).toBe(2);
    expect(await db.reviewLogs.count()).toBe(2);
    expect(await db.dailyStats.count()).toBe(1);
    expect((await getLearnedWordIds()).size).toBe(2);

    await clearLearningProgress();

    expect(await db.userWords.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await db.dailyStats.count()).toBe(0);
    expect(await db.words.count()).toBe(3); // 词库保留
    expect((await getLearnedWordIds()).size).toBe(0); // 缓存已失效
  });

  it('resetDatabase：全量清空（含词库）', async () => {
    await recordRating(WORDS[0], null, Rating.Good, 'learn', 1000);
    await resetDatabase();
    expect(await db.words.count()).toBe(0);
    expect(await db.userWords.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await db.dailyStats.count()).toBe(0);
  });

  it('resetAllData + resetExceptAi：清空全部数据（含 meta），设置仅保留 AI 配置', async () => {
    await recordRating(WORDS[0], null, Rating.Good, 'learn', 1000);
    await db.meta.put({ key: 'syncHandle', value: { fake: true } });
    expect(await db.meta.count()).toBe(1);
    // 模拟用户改过的设置：AI 配置 + 非 AI 配置
    useSettings.getState().set({
      aiProvider: 'tokenrhythm',
      aiApiKey: 'sk-test-key',
      aiBaseUrl: 'https://tokenrhythm.studio/v1',
      aiModel: 'deepseek-v4-flash-0731',
      darkMode: true,
      dailyNewLimit: 99,
      reminderTime: '21:30',
    });

    await resetAllData();
    useSettings.getState().resetExceptAi();

    // 数据全清（含词库、学习进度、统计、meta 同步句柄）
    expect(await db.words.count()).toBe(0);
    expect(await db.userWords.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await db.dailyStats.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
    // 已学缓存失效
    expect((await getLearnedWordIds()).size).toBe(0);
    // 设置：AI 配置保留，其余恢复默认
    const s = useSettings.getState().settings;
    expect(s.aiProvider).toBe('tokenrhythm');
    expect(s.aiApiKey).toBe('sk-test-key');
    expect(s.aiBaseUrl).toBe('https://tokenrhythm.studio/v1');
    expect(s.aiModel).toBe('deepseek-v4-flash-0731');
    expect(s.darkMode).toBe(DEFAULT_SETTINGS.darkMode);
    expect(s.dailyNewLimit).toBe(DEFAULT_SETTINGS.dailyNewLimit);
    expect(s.reminderTime).toBe(DEFAULT_SETTINGS.reminderTime);
    expect(s.activeBooks).toEqual(DEFAULT_SETTINGS.activeBooks);
  });
});
