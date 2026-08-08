import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, resetDatabase } from '@/db/schema';
import { importCustomWords, parseCustomCsv } from '@/services/wordbook';
import { recordRating } from '@/services/study';
import { Rating } from '@/types';
import type { Word } from '@/types';
import {
  syncToFolder,
  readBackupFromFolder,
  restoreFromFolder,
  scheduleSync,
  setSyncDebounceMs,
  setHandleResolverForTest,
} from '@/services/localfile';

/** 内存假文件夹句柄（模拟 File System Access API 的目录句柄） */
function makeFakeDir(): FileSystemDirectoryHandle {
  const files = new Map<string, { content: string }>();
  return {
    name: 'test-sync-folder',
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name) && !opts?.create) throw new Error('NotFoundError');
      if (!files.has(name)) files.set(name, { content: '' });
      const entry = files.get(name)!;
      return {
        async createWritable() {
          return {
            async write(s: string) {
              entry.content += s;
            },
            async close() {},
          };
        },
        async getFile() {
          return { text: async () => entry.content };
        },
      };
    },
    async queryPermission() {
      return 'granted';
    },
    async requestPermission() {
      return 'granted';
    },
  } as unknown as FileSystemDirectoryHandle;
}

beforeEach(async () => {
  await resetDatabase();
  await db.meta.clear();
  setSyncDebounceMs(50);
  setHandleResolverForTest(null);
});

describe('本地文件夹同步', () => {
  it('同步写盘 → 读回 → 清库后恢复（全量备份往返）', async () => {
    // 造数据：导入自定义词书 + 学习一个词
    await importCustomWords(parseCustomCsv('name,trans\napple,苹果\nbanana,香蕉\n'), 'custom:测试');
    const apple: Word = (await db.words.get('apple'))!;
    await recordRating(apple, null, Rating.Good, 'learn', 5000);

    const dir = makeFakeDir();
    // 写入同步文件
    expect(await syncToFolder(dir)).toBe(true);
    // 读回校验内容
    const backup = await readBackupFromFolder(dir);
    expect(backup?.app).toBe('wordmemory');
    expect(backup?.words.some((w) => w.w === 'apple')).toBe(true);
    expect(backup?.userWords).toHaveLength(1);
    expect(backup?.dailyStats.length).toBeGreaterThan(0);

    // 清库（模拟清站点数据 / 清空学习数据）后从备份恢复
    await resetDatabase();
    await db.meta.clear();
    setHandleResolverForTest(async () => dir); // 恢复走默认解析路径，注入假句柄
    const restored = await restoreFromFolder();
    expect(restored.userWords).toHaveLength(1);
    expect((await db.words.get('apple'))?.m).toEqual(['苹果']);
    expect(await db.userWords.get('apple')).toBeTruthy();
    expect((await db.dailyStats.toArray()).length).toBeGreaterThan(0);
  });

  it('未配置文件夹时同步静默跳过（不影响主流程）', async () => {
    setHandleResolverForTest(async () => null);
    await expect(syncToFolder()).resolves.toBe(false);
    await expect(readBackupFromFolder()).resolves.toBeNull();
  });

  it('数据变化后自动防抖写盘', async () => {
    const dir = makeFakeDir();
    setHandleResolverForTest(async () => dir);
    await importCustomWords(parseCustomCsv('name,trans\ntest1,测试一\n'), 'custom:测试');

    // 模拟评分/导入后的自动触发：防抖 50ms 后落盘
    scheduleSync();
    await new Promise((r) => setTimeout(r, 300));
    const backup = await readBackupFromFolder(dir);
    expect(backup?.words.some((w) => w.w === 'test1')).toBe(true);
  });
});
