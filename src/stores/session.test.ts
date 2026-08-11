import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 服务层，聚焦会话状态机：回炉分母固定 / 批量回忆确认 / 重学队列 / 完成判定
vi.mock('@/services/study', () => ({
  loadLearnQueue: vi.fn(),
  loadReviewQueue: vi.fn(),
  loadRandomQueue: vi.fn(),
  recordRating: vi.fn(),
  resetWordLearning: vi.fn(),
}));
vi.mock('@/services/stats', () => ({
  getTodayNewCount: vi.fn().mockResolvedValue(0),
  getDueCount: vi.fn().mockResolvedValue(0),
  getTodayReviewQuotaUsed: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/stores/settings', () => ({
  useSettings: { getState: () => ({ settings: { dailyNewLimit: 100, dailyReviewLimit: 100, groupSize: 10 } }) },
}));

import { useSession } from './session';
import { loadLearnQueue, loadReviewQueue, recordRating, resetWordLearning } from '@/services/study';
import { getTodayNewCount, getDueCount, getTodayReviewQuotaUsed } from '@/services/stats';
import { State } from 'ts-fsrs';
import type { ReviewLog, UserWord, Word } from '@/types';

const WORDS: Word[] = [
  { w: 'apple', m: ['苹果'], freq: 1, books: ['test'] },
  { w: 'banana', m: ['香蕉'], freq: 2, books: ['test'] },
  { w: 'cherry', m: ['樱桃'], freq: 3, books: ['test'] },
];

function cardFor(w: string): UserWord {
  return {
    wordId: w,
    bookIds: ['test'],
    due: Date.now() + 86400000,
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    state: State.Review,
    learningSteps: 0,
    lastReviewAt: Date.now(),
    createdAt: Date.now(),
    wrongCount: 0,
    lastRating: 3,
  };
}

function logFor(wordId: string, rating: number): ReviewLog {
  return {
    wordId,
    rating,
    elapsedMs: 1000,
    reviewedAt: Date.now(),
    scheduledDays: 1,
    state: State.Review,
    mode: 'learn',
  };
}

describe('学习会话状态机', () => {
  beforeEach(() => {
    vi.mocked(loadLearnQueue).mockReset();
    vi.mocked(loadReviewQueue).mockReset();
    vi.mocked(recordRating).mockReset();
    vi.mocked(resetWordLearning).mockReset();
    vi.mocked(getTodayNewCount).mockReset();
    vi.mocked(getTodayNewCount).mockResolvedValue(0);
    vi.mocked(getDueCount).mockReset();
    vi.mocked(getDueCount).mockResolvedValue(0);
    vi.mocked(getTodayReviewQuotaUsed).mockReset();
    vi.mocked(getTodayReviewQuotaUsed).mockResolvedValue(0);
    useSession.getState().reset();
  });

  it('初始队列长度固定为进度分母，回炉追加不改变分母', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue(WORDS);
    await useSession.getState().start('learn');
    expect(useSession.getState().initialTotal).toBe(3);
    expect(useSession.getState().status).toBe('running');

    // 回炉：rating=2（勉强）未掌握 → 追加到队尾，分母与完成数都不变
    vi.mocked(recordRating).mockResolvedValue({
      updated: { ...cardFor('apple'), state: State.Learning },
      log: logFor('apple', 2),
    });
    await useSession.getState().rate(2);
    expect(useSession.getState().queue).toHaveLength(4); // 追加 1 词
    expect(useSession.getState().initialTotal).toBe(3); // 分母不变
    expect(useSession.getState().doneCount).toBe(0); // 未掌握不计完成
    expect(useSession.getState().status).toBe('running');
  });

  it('学习模式评 3/4 掌握：不暂停，攒入批量回忆列表，本轮学完才进入回忆确认', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue(WORDS);
    await useSession.getState().start('learn');

    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    // 不暂停：继续推进，词攒进回忆列表
    expect(useSession.getState().phase).toBe('study');
    expect(useSession.getState().recallList).toHaveLength(1);
    expect(useSession.getState().index).toBe(1);
    expect(useSession.getState().doneCount).toBe(1);

    // 学完其余词 → 进入批量回忆确认
    await useSession.getState().rate(3);
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');
    expect(useSession.getState().recallList).toHaveLength(3);
    expect(useSession.getState().status).toBe('running'); // 等回忆确认
  });

  it('批量回忆确认：先翻面看英文，再确认「确实记住了」→ 完成', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue(WORDS);
    await useSession.getState().start('learn');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 4) });
    await useSession.getState().rate(4);
    await useSession.getState().rate(4);
    await useSession.getState().rate(4);
    expect(useSession.getState().phase).toBe('recall');
    // 进入回忆时未翻面：只出中文，需先翻面看英文
    expect(useSession.getState().recallRevealed).toBe(false);

    // 第一步：翻面显示英文
    useSession.getState().revealRecall();
    expect(useSession.getState().recallRevealed).toBe(true);
    // 第二步：确认确实记住了 → 下一项重置为未翻面
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().recallIndex).toBe(1);
    expect(useSession.getState().recallRevealed).toBe(false);

    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(true);
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().status).toBe('finished');
    expect(useSession.getState().doneCount).toBe(3);
    expect(useSession.getState().initialTotal).toBe(3);
  });

  it('回忆「没想起来」：清空数据进入重学队列，重学通过后再二次回忆确认，确认通过才完成', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue(WORDS.slice(0, 2));
    await useSession.getState().start('learn');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');

    // apple 记错了 → 清空数据，进入重学队列；继续确认 banana
    vi.mocked(resetWordLearning).mockResolvedValue(true);
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(false);
    expect(resetWordLearning).toHaveBeenCalledWith('apple');
    expect(useSession.getState().relearnQueue).toHaveLength(1);
    expect(useSession.getState().recallIndex).toBe(1);
    expect(useSession.getState().recallRevealed).toBe(false);
    expect(useSession.getState().phase).toBe('recall');

    // banana 确实记住了 → 进入重学阶段
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().phase).toBe('relearn');

    // 重学 apple 评 3 → 通过：不是直接完成，而是带着 apple 再次进入回忆确认
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');
    expect(useSession.getState().recallList).toHaveLength(1);
    expect(useSession.getState().recallList[0].word.w).toBe('apple');
    expect(useSession.getState().recallList[0].retries).toBe(1); // 重学次数如实递增
    expect(useSession.getState().status).toBe('running');

    // 二次确认：翻面 → 确实记住了 → 才真正完成
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().status).toBe('finished');
  });

  it('闭环：二次确认再记错 → 再重学 → 再确认，直到通过才完成', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue([WORDS[0]]);
    await useSession.getState().start('learn');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');

    // 第一轮回忆：记错 → 重学
    vi.mocked(resetWordLearning).mockResolvedValue(true);
    await useSession.getState().confirmRecall(false);
    expect(useSession.getState().phase).toBe('relearn');
    expect(useSession.getState().relearnQueue).toHaveLength(1);

    // 重学评 3 通过 → 进入二次确认（retries=1）
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');
    expect(useSession.getState().recallList[0].retries).toBe(1);

    // 二次确认：又记错 → 再次清空进入重学（retries 继续递增）
    await useSession.getState().confirmRecall(false);
    expect(resetWordLearning).toHaveBeenCalledTimes(2);
    expect(useSession.getState().phase).toBe('relearn');
    expect(useSession.getState().relearnQueue).toHaveLength(1);
    expect(useSession.getState().relearnQueue[0].retries).toBe(2);

    // 再重学评 3 通过 → 第三次确认（retries=2）
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');
    expect(useSession.getState().recallList[0].retries).toBe(2);

    // 第三次确认：确实记住了 → 完成
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().status).toBe('finished');
    expect(useSession.getState().doneCount).toBe(1);
  });

  it('正确率：回炉与回忆记错都计入作答次数，真实反映本轮表现', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue(WORDS.slice(0, 2));
    await useSession.getState().start('learn');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });

    // apple 第一次评 1 没掌握 → 回炉再学，评 3 掌握；banana 一次评 3 掌握
    await useSession.getState().rate(1);
    await useSession.getState().rate(3);
    await useSession.getState().rate(3);
    expect(useSession.getState().doneCount).toBe(2);
    expect(useSession.getState().attemptCount).toBe(3); // 2 次 apple + 1 次 banana
    expect(useSession.getState().correctCount).toBe(2); // 评 3 的两次算答对

    // 进入回忆：apple 记错（第 1 项）→ 计入一次答错；banana 确实记住 → 计入一次答对
    vi.mocked(resetWordLearning).mockResolvedValue(true);
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(false);
    expect(useSession.getState().attemptCount).toBe(4);
    expect(useSession.getState().correctCount).toBe(2);
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().attemptCount).toBe(5);
    expect(useSession.getState().correctCount).toBe(3);

    // 重学 apple 评 3 → 二次确认记住 → 完成；正确率 = 5/7 ≈ 71%
    await useSession.getState().rate(3);
    expect(useSession.getState().attemptCount).toBe(6);
    expect(useSession.getState().correctCount).toBe(4);
    await useSession.getState().revealRecall();
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().status).toBe('finished');
    expect(useSession.getState().attemptCount).toBe(7);
    expect(useSession.getState().correctCount).toBe(5);
    expect(Math.round((useSession.getState().correctCount / useSession.getState().attemptCount) * 100)).toBe(71);
  });

  it('重学阶段 1/2 回炉：重学队列追加，全部通过后进入二次确认，确认通过才完成', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue([WORDS[0]]);
    await useSession.getState().start('learn');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');

    // 没想起来 → 进入重学
    vi.mocked(resetWordLearning).mockResolvedValue(true);
    await useSession.getState().confirmRecall(false);
    expect(useSession.getState().phase).toBe('relearn');
    expect(useSession.getState().relearnQueue).toHaveLength(1);

    // 重学评 2（未掌握）→ 重学队列追加，继续
    await useSession.getState().rate(2);
    expect(useSession.getState().relearnQueue).toHaveLength(2);
    expect(useSession.getState().relearnIndex).toBe(1);

    // 再学（队尾）评 3 → 通过：不直接完成，进入二次确认
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');
    expect(useSession.getState().recallList).toHaveLength(1);
    expect(useSession.getState().doneCount).toBe(1); // 重学不计入进度分母

    // 二次确认通过 → 完成
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().status).toBe('finished');
  });

  it('复习模式无回忆环节：答对直接完成', async () => {
    vi.mocked(loadReviewQueue).mockResolvedValue([
      { word: WORDS[0], userWord: cardFor('apple') },
    ]);
    await useSession.getState().start('review');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    expect(useSession.getState().recallList).toHaveLength(0); // 复习不触发回忆
    expect(useSession.getState().phase).toBe('study');
    expect(useSession.getState().doneCount).toBe(1);
    expect(useSession.getState().status).toBe('finished');
  });

  it('复习模式答错(1)当场回炉，答对才计入完成', async () => {
    vi.mocked(loadReviewQueue).mockResolvedValue([
      { word: WORDS[0], userWord: cardFor('apple') },
      { word: WORDS[1], userWord: cardFor('banana') },
    ]);
    await useSession.getState().start('review');
    expect(useSession.getState().status).toBe('running');
    expect(useSession.getState().initialTotal).toBe(2);

    // 答错（忘记）→ 回炉：追加到队尾，不计完成
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 1) });
    await useSession.getState().rate(1);
    expect(useSession.getState().queue).toHaveLength(3); // 追加 1 词
    expect(useSession.getState().doneCount).toBe(0);
    expect(useSession.getState().status).toBe('running');

    // 再答对 → 计入完成，不回炉
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    expect(useSession.getState().doneCount).toBe(1);
    expect(useSession.getState().status).toBe('running');
  });

  it('复习模式评 2（模糊）也回炉：1-2 都当场再考，3-4 才计入完成', async () => {
    vi.mocked(loadReviewQueue).mockResolvedValue([
      { word: WORDS[0], userWord: cardFor('apple') },
    ]);
    await useSession.getState().start('review');

    // 模糊（记错）→ 回炉：追加到队尾，不计完成（不能「记错也算复习完」）
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 2) });
    await useSession.getState().rate(2);
    expect(useSession.getState().queue).toHaveLength(2); // 追加 1 词
    expect(useSession.getState().doneCount).toBe(0);
    expect(useSession.getState().status).toBe('running');

    // 再考答对 → 完成
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    expect(useSession.getState().doneCount).toBe(1);
    expect(useSession.getState().status).toBe('finished');
  });

  it('复习分组：一次只加载一组，到期词多于本组且配额富余时 hasMore=true', async () => {
    vi.mocked(loadReviewQueue).mockResolvedValue([
      { word: WORDS[0], userWord: cardFor('apple') },
      { word: WORDS[1], userWord: cardFor('banana') },
    ]);
    vi.mocked(getDueCount).mockResolvedValue(5); // 到期 5 个，本组只加载 2 个
    await useSession.getState().start('review');
    expect(loadReviewQueue).toHaveBeenCalledWith(10); // 默认组大小
    expect(useSession.getState().initialTotal).toBe(2);
    expect(useSession.getState().hasMore).toBe(true);

    // 到期词与加载数相等 → 没有下一组
    vi.mocked(getDueCount).mockResolvedValue(2);
    await useSession.getState().start('review');
    expect(useSession.getState().hasMore).toBe(false);
  });

  it('复习分组：每日复习配额耗尽后不再提示下一组', async () => {
    // 配额 100，已用 95 → 剩余 5，本组最多加载 5 个（模拟 loadReviewQueue 按配额截断）
    const five = ['apple', 'banana', 'cherry', 'date', 'elder'].map((w) => ({
      word: { w, m: [w], freq: 1, books: ['test'] } as Word,
      userWord: cardFor(w),
    }));
    vi.mocked(loadReviewQueue).mockResolvedValue(five);
    vi.mocked(getTodayReviewQuotaUsed).mockResolvedValue(95);
    vi.mocked(getDueCount).mockResolvedValue(10);
    await useSession.getState().start('review');
    expect(useSession.getState().initialTotal).toBe(5);
    expect(useSession.getState().hasMore).toBe(false);
  });
});
