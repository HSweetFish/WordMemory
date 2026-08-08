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
}));
vi.mock('@/stores/settings', () => ({
  useSettings: { getState: () => ({ settings: { dailyNewLimit: 100 } }) },
}));

import { useSession } from './session';
import { loadLearnQueue, loadReviewQueue, recordRating, resetWordLearning } from '@/services/study';
import { getTodayNewCount } from '@/services/stats';
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

  it('批量回忆确认：全部「记起来了」→ 完成', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue(WORDS);
    await useSession.getState().start('learn');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 4) });
    await useSession.getState().rate(4);
    await useSession.getState().rate(4);
    await useSession.getState().rate(4);
    expect(useSession.getState().phase).toBe('recall');

    await useSession.getState().confirmRecall(true);
    await useSession.getState().confirmRecall(true);
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().status).toBe('finished');
    expect(useSession.getState().doneCount).toBe(3);
    expect(useSession.getState().initialTotal).toBe(3);
  });

  it('回忆「没想起来」：清空数据进入重学队列，重学掌握后完成', async () => {
    vi.mocked(loadLearnQueue).mockResolvedValue(WORDS.slice(0, 2));
    await useSession.getState().start('learn');
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    await useSession.getState().rate(3);
    expect(useSession.getState().phase).toBe('recall');

    // apple 没想起来 → 清空数据，进入重学队列；继续确认 banana
    vi.mocked(resetWordLearning).mockResolvedValue(true);
    await useSession.getState().confirmRecall(false);
    expect(resetWordLearning).toHaveBeenCalledWith('apple');
    expect(useSession.getState().relearnQueue).toHaveLength(1);
    expect(useSession.getState().recallIndex).toBe(1);
    expect(useSession.getState().phase).toBe('recall');

    // banana 记起来了 → 进入重学阶段
    await useSession.getState().confirmRecall(true);
    expect(useSession.getState().phase).toBe('relearn');

    // 重学 apple 评 3 → 掌握，完成
    vi.mocked(recordRating).mockResolvedValue({ updated: cardFor('apple'), log: logFor('apple', 3) });
    await useSession.getState().rate(3);
    expect(useSession.getState().status).toBe('finished');
  });

  it('重学阶段 1/2 回炉：重学队列追加，直到掌握才完成', async () => {
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

    // 再学（队尾）评 3 → 掌握，完成
    await useSession.getState().rate(3);
    expect(useSession.getState().status).toBe('finished');
    expect(useSession.getState().doneCount).toBe(1); // 重学不计入进度分母
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
});
