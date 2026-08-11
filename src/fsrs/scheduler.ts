import { fsrs, generatorParameters, Rating, State, createEmptyCard, type Card, type Grade } from 'ts-fsrs';
import { dateKey, shiftDateKey, dayRangeInZone } from '@/lib/format';
import type { UserWord } from '@/types';

/**
 * 排程引擎：封装 FSRS（Free Spaced Repetition Scheduler）。
 *
 * FSRS 是基于真实学习数据的间隔重复算法（Anki 官方集成），
 * 相比经典 SM-2 能根据个人答题历史自适应记忆稳定性与难度。
 * 通过 IScheduler 抽象预留了 SM-2 备选实现（schedulerFactory）。
 */

export interface ReviewResult {
  /** 更新后的用户词条（写回 user_words） */
  updated: UserWord;
  /** 本次排程天数（0 表示当天再次出现） */
  scheduledDays: number;
  /** 复习后的 FSRS 状态 */
  state: number;
  /** 记忆稳定性（天） */
  stability: number;
}

export interface IScheduler {
  /** 创建新词卡片 */
  createCard(wordId: string, bookIds: string[], now?: Date): UserWord;
  /** 对一张卡片按评分复习，返回更新结果 */
  review(userWord: UserWord, rating: Rating, now?: Date): ReviewResult;
  /** 当前回忆概率（遗忘曲线） */
  retention(userWord: UserWord, now?: Date): number;
}

/** 从 ts-fsrs Card 映射到 UserWord（保留业务字段） */
function applyCard(uw: UserWord, card: Card): UserWord {
  return {
    ...uw,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as UserWord['state'],
    learningSteps: card.learning_steps,
    lastReviewAt: card.last_review ? card.last_review.getTime() : uw.lastReviewAt,
  };
}

/** 从 UserWord 映射到 ts-fsrs Card */
function toCard(uw: UserWord): Card {
  return {
    due: new Date(uw.due),
    stability: uw.stability,
    difficulty: uw.difficulty,
    elapsed_days: uw.elapsedDays,
    scheduled_days: uw.scheduledDays,
    reps: uw.reps,
    lapses: uw.lapses,
    state: uw.state as State,
    learning_steps: uw.learningSteps ?? 0,
    last_review: uw.lastReviewAt ? new Date(uw.lastReviewAt) : undefined,
  };
}

// ---- FSRS 实现 ----

const FSRS_PARAMS = {
  // 目标记忆保留率 95%（保守节奏，接近艾宾浩斯的频繁复习，
  // 但比固定表智能：答错立刻回炉、答对才拉长）
  request_retention: 0.95,
  // 最大间隔 730 天（两年）：长期熟练的词两年复一次，避免间隔无限爆炸；
  // 又保留 365 天以上的空间，让「已掌握（间隔≥365 天）」能真实出现
  maximum_interval: 730,
  // 轻微随机化间隔，避免卡片扎堆（Anki 默认行为，±5% 抖动可接受）
  enable_fuzz: true,
  // 不使用当天学习步骤（ts-fsrs 单步学习步骤会直接毕业）：新词首次评分后
  // 由业务层（review 中 New 分支）强制把第一次复习排到第二天
  learning_steps: [] as const,
  // 复习答错后的重学步骤：1 天（业务层负责当场回炉再考，FSRS 层保证
  // 即使回炉仍未掌握，下次到期也在第二天以后，不再当天 10 分钟循环）
  relearning_steps: ['1d'] as const,
};

const f = fsrs(generatorParameters(FSRS_PARAMS));

class FSRSImpl implements IScheduler {
  createCard(wordId: string, bookIds: string[], now: Date = new Date()): UserWord {
    const card = createEmptyCard(now);
    return {
      wordId: wordId.toLowerCase(),
      bookIds,
      due: card.due.getTime(),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state as UserWord['state'],
      learningSteps: card.learning_steps,
      lastReviewAt: null,
      createdAt: now.getTime(),
      wrongCount: 0,
      lastRating: null,
    };
  }

  review(userWord: UserWord, rating: Rating, now: Date = new Date()): ReviewResult {
    // 不跳步：全新卡片（New）点「很熟练」也按「学会了」处理，
    // 避免没学过的词直接获得过高的初始稳定性（后续间隔暴涨）
    const effective = userWord.state === State.New && rating === Rating.Easy ? Rating.Good : rating;
    const item = f.repeat(toCard(userWord), now)[effective as Grade];
    // 新词首次评分：强制第一次复习排到「明天 0 点」（东八区日历日），而不是 24 小时后。
    // 昨晚学的词今天 0 点后即可复习，符合「隔天复习」直觉；白天学的词第二天一早就能复习。
    if (userWord.state === State.New) {
      const tomorrowStart = dayRangeInZone(shiftDateKey(dateKey(now), 1))[0];
      item.card.due = new Date(tomorrowStart);
      item.card.scheduled_days = 1;
    }
    const updated: UserWord = {
      ...applyCard(userWord, item.card),
      lastRating: rating,
      // Again 记为一次答错（薄弱词分析依据）
      wrongCount: userWord.wrongCount + (rating === Rating.Again ? 1 : 0),
    };
    return {
      updated,
      scheduledDays: item.card.scheduled_days,
      state: item.card.state,
      stability: item.card.stability,
    };
  }

  retention(userWord: UserWord, now: Date = new Date()): number {
    // 使用 FSRS 实例的 retrievability（与排程同参数，避免手算 decay 不一致）
    if (userWord.stability <= 0) return 0;
    const r = f.get_retrievability(toCard(userWord), now, false);
    return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  }
}

// ---- SM-2 备选实现（经典 Anki 算法，质量分 0-5）----

class SM2Impl implements IScheduler {
  createCard(wordId: string, bookIds: string[], now: Date = new Date()): UserWord {
    return {
      wordId: wordId.toLowerCase(),
      bookIds,
      due: now.getTime(),
      stability: 0,
      difficulty: 2.5,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: State.New,
      learningSteps: 0,
      lastReviewAt: null,
      createdAt: now.getTime(),
      wrongCount: 0,
      lastRating: null,
    };
  }

  review(userWord: UserWord, rating: Rating, now: Date = new Date()): ReviewResult {
    // 映射：Again=2(彻底遗忘), Hard=3, Good=4, Easy=5
    const q = rating === Rating.Again ? 2 : rating === Rating.Hard ? 3 : rating === Rating.Good ? 4 : 5;
    let ef = userWord.difficulty || 2.5;
    if (q < 3) ef = Math.max(1.3, ef - 0.2);
    else if (q === 3) ef = Math.max(1.3, ef - 0.05);
    else ef = Math.max(1.3, ef + 0.1);

    let interval: number;
    if (q < 3) {
      interval = 0; // 当天重学
    } else if (userWord.reps === 0) {
      interval = 1;
    } else if (userWord.reps === 1) {
      interval = 6;
    } else {
      interval = Math.round((userWord.scheduledDays || 6) * ef);
    }
    interval = Math.min(interval, 36500);

    const updated: UserWord = {
      ...userWord,
      due: now.getTime() + interval * 86400000,
      stability: interval > 0 ? interval : 0,
      difficulty: ef,
      elapsedDays: Math.round((now.getTime() - (userWord.lastReviewAt ?? now.getTime())) / 86400000),
      scheduledDays: interval,
      reps: userWord.reps + (q < 3 ? 0 : 1),
      lapses: userWord.lapses + (q < 3 ? 1 : 0),
      state: (q < 3 ? State.Relearning : interval > 0 ? State.Review : State.Learning) as UserWord['state'],
      lastReviewAt: now.getTime(),
      lastRating: rating as UserWord['lastRating'],
      wrongCount: userWord.wrongCount + (rating === Rating.Again ? 1 : 0),
    };
    return {
      updated,
      scheduledDays: interval,
      state: updated.state,
      stability: updated.stability,
    };
  }

  retention(userWord: UserWord, now: Date = new Date()): number {
    if (!userWord.stability || userWord.stability <= 0) return 0;
    const elapsed = Math.max(0, (now.getTime() - (userWord.lastReviewAt ?? userWord.due)) / 86400000);
    return Math.min(1, Math.max(0, Math.pow(2, -elapsed / userWord.stability)));
  }
}

// ---- 工厂与默认实例 ----

export type SchedulerKind = 'fsrs' | 'sm2';

let activeKind: SchedulerKind = 'fsrs';

/** 切换排程算法（默认 fsrs，sm2 为备选） */
export function setSchedulerKind(kind: SchedulerKind): void {
  activeKind = kind;
}

export function getSchedulerKind(): SchedulerKind {
  return activeKind;
}

export function getScheduler(): IScheduler {
  return activeKind === 'fsrs' ? fsrsImpl : sm2Impl;
}

const fsrsImpl: IScheduler = new FSRSImpl();
const sm2Impl: IScheduler = new SM2Impl();

// 默认实例（避免每次调用 getScheduler 的开销）
export const scheduler: IScheduler = fsrsImpl;
