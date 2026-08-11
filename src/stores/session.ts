import { create } from 'zustand';
import { loadLearnQueue, loadReviewQueue, loadRandomQueue, recordRating, resetWordLearning } from '@/services/study';
import { getTodayNewCount, getDueCount, getTodayReviewQuotaUsed } from '@/services/stats';
import { useSettings } from '@/stores/settings';
import type { Word, UserWord, Rating } from '@/types';

/** 练习模式 */
export type PracticeMode = 'flip' | 'quiz' | 'spell';
/** 会话类型 */
export type StudyMode = 'learn' | 'review' | 'random';

interface StudyItem {
  word: Word;
  userWord: UserWord | null;
  /** 该词累计回炉/重学次数（展示用） */
  retries?: number;
}

/** 会话阶段：study 学习 / recall 批量回忆确认 / relearn 回忆失败重学 */
export type SessionPhase = 'study' | 'recall' | 'relearn';

interface SessionState {
  mode: StudyMode;
  practice: PracticeMode;
  status: 'idle' | 'loading' | 'running' | 'finished';
  queue: StudyItem[];
  index: number;
  /** 会话开始时队列长度（学习模式的进度分母；回炉追加的词不计入，保证「x / 总新词数」不虚涨） */
  initialTotal: number;
  /** 当前题目开始时间（用于统计反应时长） */
  itemStartedAt: number;
  sessionStartedAt: number;
  /** 会话内完成数 */
  doneCount: number;
  /** 会话内答对数 */
  correctCount: number;
  /** 会话内总作答次数（每次评分 + 每次回忆确认；跳过/翻面不计） */
  attemptCount: number;
  /** 学习模式：今日配额是否还有剩余（完成页显示「继续下一组」） */
  hasMore: boolean;
  /** 当前阶段 */
  phase: SessionPhase;
  /** 学习阶段掌握（评 3/4）的词，本轮全部学完后批量回忆确认（按 wordId 去重） */
  recallList: StudyItem[];
  recallIndex: number;
  /** 回忆确认：当前词是否已翻面显示英文（两步式：先出中文回忆 → 翻面看英文 → 再选记住/记错） */
  recallRevealed: boolean;
  /** 回忆确认失败、需重新学习的词 */
  relearnQueue: StudyItem[];
  relearnIndex: number;
  /** 重学通过（评 3/4）的词，攒入此处；重学队列全部学完后带着它们再次进入 recall 二次确认（闭环：重学不能绕过回忆关卡） */
  reconfirmList: StudyItem[];
  error: string | null;
  start: (mode: StudyMode) => Promise<void>;
  /** 提交评分并进入下一题 */
  rate: (rating: Rating) => Promise<void>;
  /** 回忆确认：翻面显示英文答案 */
  revealRecall: () => void;
  /** 回忆确认：确实记住了 → 下一个；记错了 → 清空数据进入重学队列 */
  confirmRecall: (remembered: boolean) => Promise<void>;
  /** 跳过当前词（学习模式允许，不计入统计） */
  skip: () => void;
  /** 设置练习模式 */
  setPractice: (mode: PracticeMode) => void;
  reset: () => void;
}

const initialState = {
  mode: 'learn' as StudyMode,
  practice: 'flip' as PracticeMode,
  status: 'idle' as const,
  queue: [],
  index: 0,
  initialTotal: 0,
  itemStartedAt: 0,
  sessionStartedAt: 0,
  doneCount: 0,
  correctCount: 0,
  attemptCount: 0,
  hasMore: false,
  phase: 'study' as SessionPhase,
  recallList: [],
  recallIndex: 0,
  recallRevealed: false,
  relearnQueue: [],
  relearnIndex: 0,
  reconfirmList: [],
  error: null,
};

export const useSession = create<SessionState>()((set, get) => ({
  ...initialState,

  start: async (mode) => {
    set({ status: 'loading', error: null });
    try {
      const now = Date.now();
      const base = {
        mode,
        index: 0,
        itemStartedAt: now,
        sessionStartedAt: now,
        doneCount: 0,
        correctCount: 0,
        attemptCount: 0,
        phase: 'study' as SessionPhase,
        recallList: [],
        recallIndex: 0,
        recallRevealed: false,
        relearnQueue: [],
        relearnIndex: 0,
        reconfirmList: [],
      };
      if (mode === 'learn') {
        const words = await loadLearnQueue();
        // 今日配额是否还有剩余（还能再加载一组）
        const { settings } = useSettings.getState();
        const doneToday = await getTodayNewCount();
        const remaining = Math.max(0, settings.dailyNewLimit - doneToday);
        const hasMore = words.length > 0 && remaining > words.length;
        set({
          ...base,
          queue: words.map((word) => ({ word, userWord: null })),
          initialTotal: words.length,
          hasMore,
          status: words.length > 0 ? 'running' : 'finished',
        });
      } else if (mode === 'random') {
        const items = await loadRandomQueue();
        set({
          ...base,
          queue: items.map((it) => ({ word: it.word, userWord: it.userWord })),
          initialTotal: items.length,
          hasMore: false,
          status: items.length > 0 ? 'running' : 'finished',
        });
      } else {
        // 复习分组：与新学一致，一次只加载一组（默认 10），学完一组可点「继续下一组」；
        // hasMore = 到期词比本组多 且 每日复习配额还有富余（保证下一组真能加载出词）
        const { settings } = useSettings.getState();
        const groupSize = Math.max(1, settings.groupSize || 10);
        const items = await loadReviewQueue(groupSize);
        const doneToday = await getTodayReviewQuotaUsed();
        const remainingDaily = Math.max(0, settings.dailyReviewLimit - doneToday);
        const dueCount = await getDueCount();
        const hasMore = items.length > 0 && dueCount > items.length && remainingDaily > items.length;
        set({
          ...base,
          queue: items.map((it) => ({ word: it.word, userWord: it.userWord })),
          initialTotal: items.length,
          hasMore,
          status: items.length > 0 ? 'running' : 'finished',
        });
      }
    } catch (e) {
      set({ status: 'idle', error: e instanceof Error ? e.message : '加载失败' });
    }
  },

  rate: async (rating) => {
    const s = get();
    if (s.status !== 'running') return;
    const elapsedMs = Date.now() - s.itemStartedAt;

    // ---- 重学阶段：回忆失败后重新学习，评 3/4 通过 → 攒入二次确认列表；重学队列全部学完 → 再次进入 recall 回忆确认 ----
    if (s.phase === 'relearn') {
      const item = s.relearnQueue[s.relearnIndex];
      if (!item) {
        set({ status: 'finished' });
        return;
      }
      try {
        const result = await recordRating(item.word, item.userWord, rating, 'learn', elapsedMs);
        const isCorrect = rating >= 3;
        if (rating < 3) {
          set({
            relearnQueue: [...s.relearnQueue, { word: item.word, userWord: result.updated, retries: (item.retries ?? 0) + 1 }],
            relearnIndex: s.relearnIndex + 1,
            itemStartedAt: Date.now(),
            correctCount: s.correctCount + (isCorrect ? 1 : 0),
            attemptCount: s.attemptCount + 1,
          });
          return;
        }
        // 掌握：不直接完成，攒入二次确认列表，重学队列学完后统一再回忆确认一次
        const nextIndex = s.relearnIndex + 1;
        const reconfirmList = [...s.reconfirmList, { word: item.word, userWord: result.updated, retries: item.retries ?? 0 }];
        const relearnDone = nextIndex >= s.relearnQueue.length;
        if (relearnDone) {
          set({
            relearnIndex: nextIndex,
            relearnQueue: [], // 重学队列已消费完，清空避免误判还有重学词
            reconfirmList: [],
            recallList: reconfirmList,
            recallIndex: 0,
            recallRevealed: false,
            phase: 'recall',
            itemStartedAt: Date.now(),
            correctCount: s.correctCount + 1,
            attemptCount: s.attemptCount + 1,
            status: 'running',
          });
        } else {
          set({
            relearnIndex: nextIndex,
            reconfirmList,
            itemStartedAt: Date.now(),
            correctCount: s.correctCount + 1,
            attemptCount: s.attemptCount + 1,
            status: 'running',
          });
        }
      } catch (e) {
        set({ error: e instanceof Error ? e.message : '评分保存失败，请重试' });
      }
      return;
    }

    if (s.phase !== 'study' || s.index >= s.queue.length) return;
    const item = s.queue[s.index];
    try {
      const result = await recordRating(item.word, item.userWord, rating, s.mode, elapsedMs);
      const isCorrect = rating >= 3;
      const nextIndex = s.index + 1;
      // 回炉判定：
      // - 学习模式：1（没学会）/ 2（有印象）未掌握 → 回炉再学一遍
      // - 复习模式：1（忘记）/ 2（模糊）没记住 → 回炉当场再考（FSRS 已把下次到期排到第二天以后）
      // - 其余评分即完成（FSRS 自行决定下次间隔）
      const recycle = (s.mode === 'learn' || s.mode === 'review') && rating < 3;
      if (recycle) {
        set({
          queue: [...s.queue, { word: item.word, userWord: result.updated, retries: (item.retries ?? 0) + 1 }],
          index: nextIndex,
          itemStartedAt: Date.now(),
          correctCount: s.correctCount + (isCorrect ? 1 : 0),
          attemptCount: s.attemptCount + 1,
          status: 'running', // 队尾已补一个词，本轮不会提前结束
        });
        return;
      }
      // 掌握（不回炉）：
      // 学习模式：攒进批量回忆确认列表，本轮全部学完后统一弹中文回忆；
      // 复习/抽查模式无回忆环节，直接推进。
      if (s.mode === 'learn') {
        const wl = item.word.w.toLowerCase();
        const exists = s.recallList.some((r) => r.word.w.toLowerCase() === wl);
        const recallList = exists
          ? s.recallList.map((r) => (r.word.w.toLowerCase() === wl ? { ...r, retries: Math.max(r.retries ?? 0, item.retries ?? 0) } : r))
          : [...s.recallList, { word: item.word, userWord: result.updated, retries: item.retries ?? 0 }];
        const queueDone = nextIndex >= s.queue.length;
        set({
          index: nextIndex,
          itemStartedAt: Date.now(),
          doneCount: s.doneCount + 1,
          correctCount: s.correctCount + (isCorrect ? 1 : 0),
          attemptCount: s.attemptCount + 1,
          recallList,
          phase: queueDone ? 'recall' : 'study',
          recallIndex: 0,
          recallRevealed: false,
        });
        return;
      }
      set({
        index: nextIndex,
        itemStartedAt: Date.now(),
        doneCount: s.doneCount + 1,
        correctCount: s.correctCount + (isCorrect ? 1 : 0),
        attemptCount: s.attemptCount + 1,
        status: nextIndex >= s.queue.length ? 'finished' : 'running',
      });
    } catch (e) {
      // 落库失败时不推进队列，提示用户重试，避免进度丢失
      set({ error: e instanceof Error ? e.message : '评分保存失败，请重试' });
    }
  },

  /** 回忆确认：翻面显示英文答案 */
  revealRecall: () => {
    const s = get();
    if (s.status !== 'running' || s.phase !== 'recall') return;
    set({ recallRevealed: true });
  },

  confirmRecall: async (remembered) => {
    const s = get();
    if (s.status !== 'running' || s.phase !== 'recall') return;
    const item = s.recallList[s.recallIndex];
    if (!item) return;
    const nextIndex = s.recallIndex + 1;
    const recallDone = nextIndex >= s.recallList.length;
    if (!remembered) {
      // 记错了：清空该词学习数据（删卡），进入重学队列重新来过（不影响其他词）
      try {
        await resetWordLearning(item.word.w);
        const relearnQueue = [...s.relearnQueue, { word: item.word, userWord: null, retries: (item.retries ?? 0) + 1 }];
        set({
          recallIndex: nextIndex,
          recallRevealed: false,
          relearnQueue,
          phase: recallDone ? 'relearn' : 'recall',
          relearnIndex: 0,
          itemStartedAt: Date.now(),
          attemptCount: s.attemptCount + 1,
        });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : '重置失败，请重试' });
      }
      return;
    }
    // 确实记住了：确认掌握，进入下一项（全部确认完 → 有重学词则重学，否则完成）
    const hasRelearn = s.relearnQueue.length > 0;
    set({
      recallIndex: nextIndex,
      recallRevealed: false,
      phase: recallDone ? (hasRelearn ? 'relearn' : 'recall') : 'recall',
      relearnIndex: 0,
      itemStartedAt: Date.now(),
      correctCount: s.correctCount + 1,
      attemptCount: s.attemptCount + 1,
      status: recallDone && !hasRelearn ? 'finished' : 'running',
    });
  },

  skip: () => {
    const s = get();
    if (s.status !== 'running') return;
    if (s.phase === 'recall') {
      // 跳过：未翻面先翻面看答案；已翻面视为「确实记住了」
      if (!s.recallRevealed) {
        set({ recallRevealed: true });
        return;
      }
      void s.confirmRecall(true);
      return;
    }
    if (s.phase === 'relearn') {
      const nextIndex = s.relearnIndex + 1;
      const relearnDone = nextIndex >= s.relearnQueue.length;
      if (relearnDone && s.reconfirmList.length > 0) {
        // 重学队列全部跳过/学完，但有待二次确认的词 → 带着它们进入 recall
        set({
          relearnIndex: nextIndex,
          relearnQueue: [], // 重学队列已消费完
          recallList: s.reconfirmList,
          recallIndex: 0,
          recallRevealed: false,
          reconfirmList: [],
          phase: 'recall',
          itemStartedAt: Date.now(),
          status: 'running',
        });
      } else {
        set({
          relearnIndex: nextIndex,
          relearnQueue: relearnDone ? [] : s.relearnQueue,
          itemStartedAt: Date.now(),
          status: relearnDone ? 'finished' : 'running',
        });
      }
      return;
    }
    if (s.index >= s.queue.length) return;
    const nextIndex = s.index + 1;
    set({
      index: nextIndex,
      itemStartedAt: Date.now(),
      status: nextIndex >= s.queue.length ? 'finished' : 'running',
    });
  },

  setPractice: (practice) => set({ practice }),
  reset: () => set({ ...initialState, queue: [], status: 'idle' }),
}));
