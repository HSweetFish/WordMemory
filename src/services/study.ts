import { db } from '@/db/schema';
import { scheduler } from '@/fsrs/scheduler';
import { getNewWordQueue, getWords } from '@/services/wordbook';
import { addLearnedWord, invalidateLearnedCache } from '@/services/learned-cache';
import { getTodayNewCount, getTodayReviewQuotaUsed, addReviewStat } from '@/services/stats';
import { scheduleSync } from '@/services/localfile';
import { useSettings } from '@/stores/settings';
import { dateKey, dayRangeInZone } from '@/lib/format';
import type { Word, UserWord, ReviewLog, Rating } from '@/types';
import { State } from '@/types';

/**
 * 学习服务：学习/复习队列加载与评分落库
 * 学习（新词）与复习（到期词）严格分离，都走 FSRS 排程。
 */

/** 学习模式：加载今日新词队列（受每日上限与每组数量约束） */
export async function loadLearnQueue(): Promise<Word[]> {
  const { settings } = useSettings.getState();
  if (settings.activeBooks.length === 0) return [];
  const doneToday = await getTodayNewCount();
  const remaining = Math.max(0, settings.dailyNewLimit - doneToday);
  if (remaining <= 0) return [];
  // 每组数量：一次只加载一组（默认 10），学完一组可继续；每日上限仍控制总量
  const groupSize = Math.max(1, settings.groupSize || 10);
  return getNewWordQueue(settings.activeBooks, Math.min(groupSize, remaining));
}

/** 复习模式：加载到期复习队列（按到期时间排序）
 * 严格受每日复习上限约束：今日已复习数会扣减每日配额；
 * 答错的词不消耗配额（当天可补考）；dailyReviewLimit <= 0 表示关闭复习。 */
export async function loadReviewQueue(limit?: number): Promise<{ word: Word; userWord: UserWord }[]> {
  const { settings } = useSettings.getState();
  const dailyCap = settings.dailyReviewLimit;
  if (dailyCap <= 0) return [];
  const doneToday = await getTodayReviewQuotaUsed();
  const remainingDaily = Math.max(0, dailyCap - doneToday);
  if (remainingDaily <= 0) return [];
  // limit 仅为本次批大小，不能突破每日配额
  const batchSize = limit === undefined ? remainingDaily : Math.min(limit, remainingDaily);
  if (batchSize <= 0) return [];
  const dueCards = await db.userWords
    .where('due')
    .belowOrEqual(Date.now())
    .sortBy('due');
  if (dueCards.length === 0) return [];
  const picked = dueCards.slice(0, batchSize);
  const words = await getWords(picked.map((c) => c.wordId));
  const wordMap = new Map(words.map((w) => [w.w, w]));
  return picked
    .filter((c) => wordMap.has(c.wordId))
    .map((c) => ({ word: wordMap.get(c.wordId)!, userWord: c }));
}

/** 随机抽查：从已学卡片中随机抽一批（不管是否到期），检验长期记忆。
 * 排除 Learning 新手期卡片（当天还在学，抽查无意义）；不消耗每日复习配额。 */
export async function loadRandomQueue(limit = 10): Promise<{ word: Word; userWord: UserWord }[]> {
  const cards = await db.userWords.toArray();
  const candidates = cards.filter((c) => c.state !== State.Learning);
  if (candidates.length === 0) return [];
  // Fisher-Yates 洗牌后取前 limit
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked = candidates.slice(0, Math.min(limit, candidates.length));
  const words = await getWords(picked.map((c) => c.wordId));
  const wordMap = new Map(words.map((w) => [w.w, w]));
  return picked
    .filter((c) => wordMap.has(c.wordId))
    .map((c) => ({ word: wordMap.get(c.wordId)!, userWord: c }));
}

/**
 * 记录一次评分：
 * 1. 无卡片则新建（新词）
 * 2. FSRS 计算新排程
 * 3. 写 user_words + review_logs
 * 4. 增量更新 daily_stats
 */
export async function recordRating(
  word: Word,
  existing: UserWord | null,
  rating: Rating,
  mode: 'learn' | 'review' | 'random',
  elapsedMs: number,
): Promise<{ updated: UserWord; log: ReviewLog }> {
  const now = new Date();
  let card = existing;
  // 仅「该词今天还没有学习日志」的首次学习计入「今日新学」；
  // 回忆失败重置后重新学习（今天已有 learn 日志）不再重复计新学数，
  // 保证 daily_stats 增量缓存与按日志去重的 getTodayNewCount 口径一致
  const isNewWord = !card && !(await hasLearnLogToday(word.w.toLowerCase()));
  if (!card) {
    const { settings } = useSettings.getState();
    card = scheduler.createCard(word.w, word.books.length ? word.books : settings.activeBooks, now);
    // 新词入卡：同步更新已学集合缓存，避免下次取队列时重扫全表
    addLearnedWord(word.w.toLowerCase());
  }
  const result = scheduler.review(card, rating, now);
  const updated = result.updated;
  await db.userWords.put(updated);

  const log: ReviewLog = {
    wordId: word.w.toLowerCase(),
    rating,
    elapsedMs,
    reviewedAt: now.getTime(),
    scheduledDays: result.scheduledDays,
    state: result.state,
    mode,
  };
  await db.reviewLogs.add(log);

  // 增量更新当日统计（时长按秒计，粗略按每题 15 秒基线 + 反应时长）
  const durationSec = Math.max(5, Math.round(elapsedMs / 1000) + 10);
  await addReviewStat(dateKey(now), mode, rating, durationSec, isNewWord);
  // 数据已变更：触发本地文件夹自动同步（防抖，未配置时静默跳过）
  scheduleSync();
  return { updated, log };
}

/**
 * 回忆失败：清空单词的学习数据重新来过。
 * 删除该词的 FSRS 卡片（真正回到未学状态）：
 * - 词重新出现在新学队列（今天配额内或明天），可重新学习
 * - 不会进入复习队列（无卡片）
 * - 答题历史（review_logs）保留，可在记忆历史中回看
 * - 今日新学计数按 wordId 去重，重新学习不会导致计数虚高
 */
/** 该词今天是否已有学习日志（新学计数按词去重：重置后重学不重复计） */
async function hasLearnLogToday(wordId: string): Promise<boolean> {
  const [start] = dayRangeInZone(dateKey());
  const logs = await db.reviewLogs.where('wordId').equals(wordId).toArray();
  return logs.some((l) => l.mode === 'learn' && l.reviewedAt >= start);
}

export async function resetWordLearning(wordId: string): Promise<boolean> {
  const id = wordId.toLowerCase();
  const existing = await db.userWords.get(id);
  if (!existing) return false;
  await db.userWords.delete(id);
  invalidateLearnedCache(); // 词不在 user_words，需重新出现在新学队列
  scheduleSync();
  return true;
}

/** 一次性迁移：旧版本把新词首次复习排到「24 小时后」（昨晚学的词今晚才到期），
 * 改为「明天 0 点」后，把「昨天学的、尚未首次复习」的卡片提前到今天 0 点，
 * 让用户今天就能复习昨天背的词。
 * 识别特征：首次复习排程（reps=1、Review、scheduledDays=1）、上次复习在昨天或更早、
 * due 晚于今天 0 点（旧算法排到了 24h 后）；今天刚学的词因 lastReviewAt 是今天而不受影响。
 * @returns 迁移的卡片数
 */
export async function migrateLegacyFirstReviewDue(): Promise<number> {
  const todayStart = dayRangeInZone(dateKey())[0];
  const cards = await db.userWords.toArray();
  let migrated = 0;
  for (const c of cards) {
    if (
      c.reps === 1 &&
      c.state === State.Review &&
      c.scheduledDays === 1 &&
      (c.lastReviewAt ?? 0) < todayStart &&
      c.due > todayStart
    ) {
      await db.userWords.put({ ...c, due: todayStart });
      migrated++;
    }
  }
  if (migrated > 0) scheduleSync();
  return migrated;
}
