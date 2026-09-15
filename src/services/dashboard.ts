import { db } from '@/db/schema';
import { scheduler } from '@/fsrs/scheduler';
import {
  getDailyStats,
  getDailyStatsRange,
  getRecentLogs,
  getWeakWords,
  type WeakWordStat,
  getLearnedByBook,
  getLearnedWordCount,
  computeStreak,
  getTodayReviewCount,
} from '@/services/stats';
import { fetchManifest, getCustomBooks, getLearnedWordIds } from '@/services/wordbook';
import { useSettings } from '@/stores/settings';
import { dateKey, dateKeyOffset, shiftDateKey, weekStartOf, lastNDays } from '@/lib/format';
import { classifyMastery } from '@/lib/mastery';
import { State, type BookMeta, type UserWord, type Word, type DailyStat } from '@/types';

/** 仪表盘快照：并发加载小表，供多个查询复用；大表（review_logs/words）走索引按需查，避免全量拖垮首屏 */
export interface DashboardSnapshot {
  /** user_words 全量卡片 */
  cards: UserWord[];
  /** daily_stats 全量日统计 */
  dailyStats: DailyStat[];
}

/**
 * 一次扫描、多处复用（瘦身版）：只并发加载 user_words + daily_stats 两张小表。
 * review_logs（几十万条）与 words（几万条）不走全量：
 * 薄弱词按 rating 索引、今日复习按 reviewedAt 范围、遗忘曲线取近 365 天、
 * 掌握度按 *books 多值索引计数、词性分布按已学词 bulkGet。
 */
export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [cards, dailyStats] = await Promise.all([db.userWords.toArray(), db.dailyStats.toArray()]);
  return { cards, dailyStats };
}

/** 两个东八区日期字符串（YYYY-MM-DD）的日历日差（b - a，天） */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * 仪表盘数据服务：把原始统计转换为 ECharts 可直接消费的数据
 */

export interface HeatmapPoint {
  date: string;
  /** 总打卡数 = 新学 + 复习（默认口径） */
  count: number;
  /** 当天新学单词数（按首次学习去重，评分≥2） */
  newCount: number;
  /** 当天复习单词数（含抽查） */
  reviewCount: number;
}

/** 热力图展示的自然周数：固定 12 个完整自然周（周一起点，不随今天漂移） */
export const HEATMAP_WEEKS = 12;

/** 热力图日期范围：[11 周前的周一, 本周日]，闭区间共 12*7 天 */
export function heatmapRange(): [string, string] {
  const start = weekStartOf(dateKeyOffset(-(HEATMAP_WEEKS - 1) * 7));
  return [start, shiftDateKey(start, HEATMAP_WEEKS * 7 - 1)];
}

/** GitHub 风格打卡热力图（固定最近 12 个自然周）
 * 计数口径：新学单词数 + 复习单词数（newCount 按当天首次学习的词去重，复习含抽查），
 * 不含回炉/重学/回忆确认等重复答题，避免「一个词答 5 次」虚高打卡。
 * 同时携带新学/复习分量，页面可按「全部 / 新学 / 复习」切换展示。
 */
export async function getHeatmapData(snap?: DashboardSnapshot): Promise<HeatmapPoint[]> {
  const [start, end] = heatmapRange();
  const stats = snap ? snap.dailyStats : await getDailyStatsRange(start, end);
  const byDate = new Map(stats.map((s) => [s.date, s]));
  const out: HeatmapPoint[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 400) {
    const s = byDate.get(cur);
    out.push({
      date: cur,
      count: s ? s.newCount + s.reviewCount : 0,
      newCount: s ? s.newCount : 0,
      reviewCount: s ? s.reviewCount : 0,
    });
    cur = shiftDateKey(cur, 1);
    guard++;
  }
  return out;
}

export interface TrendPoint {
  date: string;
  learn: number;
  review: number;
  correctRate: number;
}

/** 最近 N 天学习趋势 */
export async function getTrendData(days = 30, snap?: DashboardSnapshot): Promise<TrendPoint[]> {
  const stats = snap ? snap.dailyStats : await getDailyStats(days);
  const byDate = new Map(stats.map((s) => [s.date, s]));
  const dates = lastNDays(days);
  return dates.map((date) => {
    const s = byDate.get(date);
    return {
      date,
      learn: s ? s.newCount : 0,
      review: s ? s.reviewCount : 0,
      correctRate: s && s.totalCount > 0 ? Math.round((s.correctCount / s.totalCount) * 100) : 0,
    };
  });
}

export interface MasterySlice {
  name: string;
  value: number;
  color: string;
}

/** 掌握度分布（环形图）
 * 四分类：未学习 / 新学中（间隔 ≤7 天）/ 巩固中（7 < 间隔 < 365 天）/ 已掌握（间隔 ≥ 365 天）。
 * 全部依据 FSRS 排程间隔（scheduledDays）判定，与答题次数无关：
 * 回炉/重复答题不改变间隔，因此不会把新学词误判为巩固中。
 */
export async function getMasteryData(snap?: DashboardSnapshot): Promise<MasterySlice[]> {
  const cards = snap?.cards ?? (await db.userWords.toArray());
  let fresh = 0; // 新学中：间隔 ≤7 天
  let consolidating = 0; // 巩固中：7 < 间隔 < 365 天
  let mastered = 0; // 已掌握：排程间隔 ≥ 365 天
  for (const c of cards) {
    const level = classifyMastery(c);
    if (level === 'mastered') mastered += 1;
    else if (level === 'learning') fresh += 1;
    else consolidating += 1;
  }
  // 未学习 = 激活词库总词数 - 已建卡数（多词库共有的词去重）
  const { settings } = useSettings.getState();
  let total = 0;
  if (settings.activeBooks.length > 0) {
    // *books 多值索引：只取激活词库的词条主键（去重），避免 words 全表扫描
    const keys = await db.words.where('books').anyOf(settings.activeBooks).primaryKeys();
    total = new Set(keys).size;
  }
  const notLearned = Math.max(0, total - cards.length);

  const slices: MasterySlice[] = [
    { name: '未学习', value: notLearned, color: '#94a3b8' },
    { name: '新学中', value: fresh, color: '#f59e0b' },
    { name: '巩固中', value: consolidating, color: '#0ea5e9' },
    { name: '已掌握', value: mastered, color: '#10b981' },
  ];
  return slices.filter((s) => s.value > 0);
}

export interface ForgettingPoint {
  days: number;
  successRate: number;
  samples: number;
}

export interface ForgettingCurveData {
  /** 实际回忆成功率（按间隔天数分桶） */
  actual: ForgettingPoint[];
  /** FSRS 理论遗忘曲线（平均稳定性） */
  theoretical: [number, number][];
  /** 平均稳定性（天） */
  avgStability: number;
}

/** 个人记忆保持率（生存分析 KM 阶梯曲线）
 * 学习完成 = 该词第一条 learn 且评分≥2 的日志（学会时刻）。
 * 首次失败 = 学习完成后第一条 review/random 且评分≤2 的日志
 *   （1-2 档都会触发当场回炉 = 未通过，视为遗忘；3-4 档视为保持）。
 * 保持率(第 D 天) = 学习后 D 天内「从未被判定为遗忘」的词占比（KM 估计，单调不增）。
 * 记忆单调衰减假设：第 7 天复习通过 → 第 1~7 天都计入保持（前 6 天必然记得）；
 * 第 14 天失败 → 从第 14 天起退出保持组，曲线在失败日下降一档；
 * 未复习的日子按「未被判定为遗忘」计保持（乐观），曲线呈阶梯状。
 */
export async function getForgettingCurveData(snap?: DashboardSnapshot): Promise<ForgettingCurveData> {
  // 只取近 365 天日志（reviewedAt 索引范围查询），不走全量
  const logs = await getRecentLogs(365);
  const today = dateKey();

  // 学习完成时间（首条 learn 且评分≥2；日志按 reviewedAt 升序）
  const learnAt = new Map<string, number>();
  // 首次失败时间（学习完成后第一条 review/random 且评分≤2）
  const failAt = new Map<string, number>();
  for (const log of logs) {
    if (log.mode === 'learn' && log.rating >= 2) {
      if (!learnAt.has(log.wordId)) learnAt.set(log.wordId, log.reviewedAt);
    } else if (log.mode !== 'learn' && log.rating <= 2) {
      const L = learnAt.get(log.wordId);
      if (L !== undefined && log.reviewedAt > L && !failAt.has(log.wordId)) failAt.set(log.wordId, log.reviewedAt);
    }
  }

  // 生存数据：每词 (学习日, 首败日|null, 事件天数 fe, 观察天数 T=学习日→今天)
  const cohort: { fe: number | null; T: number }[] = [];
  for (const [id, L] of learnAt) {
    const learnDay = dateKey(new Date(L));
    const T = dayDiff(learnDay, today);
    if (T < 1) continue; // 学习不足 1 天，尚未进入观察窗口
    const F = failAt.get(id);
    const fe = F ? dayDiff(learnDay, dateKey(new Date(F))) : null;
    if (fe !== null && fe < 1) continue; // 学习当天即失败，无跨天保持可言
    cohort.push({ fe, T });
  }

  // KM 阶梯：S(t) = S(t−1) × (1 − 第 t 天失败数 / 第 t 天风险集)
  const actual: ForgettingPoint[] = [];
  let S = 1;
  for (let t = 1; t <= 90; t++) {
    const risk = cohort.filter((w) => w.T >= t && (w.fe === null || w.fe >= t)).length;
    if (risk === 0) break;
    const events = cohort.filter((w) => w.fe === t).length;
    S *= 1 - events / risk;
    if (risk >= 2) actual.push({ days: t, successRate: Math.round(S * 100), samples: risk });
  }

  // 理论曲线：用平均稳定性的合成卡片采样 0-30 天
  let stabilitySum = 0;
  let stabilityN = 0;
  const cards = snap?.cards ?? (await db.userWords.toArray());
  for (const c of cards) {
    if (c.stability > 0) {
      stabilitySum += c.stability;
      stabilityN++;
    }
  }
  const avgStability = stabilityN > 0 ? stabilitySum / stabilityN : 0;
  const theoretical: [number, number][] = [];
  if (avgStability > 0) {
    const now = Date.now();
    const synthetic = {
      wordId: 'synthetic',
      bookIds: [],
      due: now,
      stability: avgStability,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 30,
      reps: 3,
      lapses: 0,
      state: State.Review,
      learningSteps: 0,
      lastReviewAt: now,
      createdAt: now,
      wrongCount: 0,
      lastRating: null,
    };
    for (let d = 0; d <= 30; d += 1) {
      theoretical.push([d, Math.round(scheduler.retention(synthetic, new Date(now + d * 86400000)) * 100)]);
    }
  }

  return { actual, theoretical, avgStability };
}

export interface BookProgress {
  id: string;
  name: string;
  total: number;
  learned: number;
}

/** 各词库学习进度（内置 manifest + 自定义词书；可注入 manifest 便于测试） */
export async function getBookProgress(manifest?: BookMeta[], snap?: DashboardSnapshot): Promise<BookProgress[]> {
  let list = manifest;
  if (!list) {
    try {
      list = await fetchManifest();
    } catch {
      list = [];
    }
    // 自定义词书（custom / custom:*）不在内置 manifest 中，需合并展示
    const custom = await getCustomBooks();
    list = [
      ...list,
      ...custom.map((c) => ({ id: c.id, name: c.name, desc: '自定义词书', count: c.count, file: '' })),
    ];
  }
  const learned = await getLearnedByBook(snap?.cards);
  const learnedMap = new Map(learned.map((l) => [l.bookId, l.count]));
  return list.map((b) => ({
    id: b.id,
    name: b.name,
    total: b.count,
    learned: learnedMap.get(b.id) ?? 0,
  }));
}

export interface WeakWordItem {
  name: string;
  /** 薄弱总次数 = 没记住(Again) + 模糊(Hard) */
  wrongCount: number;
  /** 明确没记住（第一档）次数 */
  againCount: number;
  /** 模糊/勉强（第二档）次数 */
  hardCount: number;
}

/** 薄弱词 Top N（仅展示词库中仍存在的词；已从词库删除的词不再展示） */
export async function getWeakWordData(limit = 10, snap?: DashboardSnapshot): Promise<WeakWordItem[]> {
  const weak = await getWeakWords(limit, snap ? { cards: snap.cards } : undefined);
  const words = await db.words.bulkGet(weak.map((w) => w.wordId));
  return weak
    .map((w, i) => ({ w, word: words[i] }))
    .filter((x): x is { w: WeakWordStat; word: Word } => !!x.word)
    .map(({ w, word }) => ({
      name: word.w,
      wrongCount: w.wrongCount,
      againCount: w.againCount,
      hardCount: w.hardCount,
    }))
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .slice(0, limit);
}

/** 词性分布（已学单词；多词性词按每个词性各计一次，如 n.；vt. → 名词 +1、及物动词 +1） */

/** 词性展示顺序（细分保留及物/不及物，便于了解动词用法差异） */
const POS_ORDER = ['n', 'vt', 'vi', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'art', 'aux', 'int'];
const POS_NAMES: Record<string, string> = {
  n: '名词',
  vt: '及物动词',
  vi: '不及物动词',
  v: '动词',
  adj: '形容词',
  adv: '副词',
  prep: '介词',
  conj: '连词',
  pron: '代词',
  num: '数词',
  art: '冠词',
  aux: '助动词',
  int: '感叹词',
};

export async function getPosDistribution(snap?: DashboardSnapshot): Promise<{ name: string; value: number }[]> {
  // 只查已学词的词条（bulkGet），不扫全量 words；已学 id 从快照或缓存拿
  const learned = snap ? new Set(snap.cards.map((c) => c.wordId)) : await getLearnedWordIds();
  const words = (await db.words.bulkGet([...learned])).filter((w): w is Word => !!w);
  const map = new Map<string, number>();
  for (const w of words) {
    if (!w.pos) continue;
    // 多词性格式如 "n.；vt.；vi." → 按全角分号拆分，逐词性计数
    for (const part of w.pos.split('；')) {
      const p = part.replace(/\./g, '').trim();
      if (!p) continue;
      map.set(p, (map.get(p) ?? 0) + 1);
    }
  }
  const nameOrder = new Map(POS_ORDER.map((p, i) => [POS_NAMES[p], i]));
  const items: { name: string; value: number }[] = [];
  let other = 0;
  for (const [pos, value] of map.entries()) {
    const name = POS_NAMES[pos];
    if (name) items.push({ name, value });
    else other += value; // 稀有/未识别类别（det/phr/abbr/pl 等）归入「其他」
  }
  if (other > 0) items.push({ name: '其他', value: other });
  items.sort((a, b) => {
    const ia = nameOrder.get(a.name) ?? POS_ORDER.length; // 「其他」排最后
    const ib = nameOrder.get(b.name) ?? POS_ORDER.length;
    return ia - ib || b.value - a.value;
  });
  return items;
}

export interface DashboardSummary {
  learnedWords: number;
  totalLogs: number;
  streak: number;
  todayReview: number;
}

/** 顶部汇总卡片数据 */
export async function getDashboardSummary(snap?: DashboardSnapshot): Promise<DashboardSummary> {
  const [learnedWords, totalLogs, streak, todayReview] = await Promise.all([
    snap ? snap.cards.length : getLearnedWordCount(),
    // 累计答题总数：索引计数 O(1)，不加载日志
    db.reviewLogs.count(),
    snap ? computeStreakFromStats(snap.dailyStats) : computeStreak(),
    // 今日复习：reviewedAt 索引只查今天范围（几百条），与日志口径严格一致，不依赖可能脏的 daily_stats
    getTodayReviewCount(),
  ]);
  return { learnedWords, totalLogs, streak, todayReview };
}

/** 从 daily_stats 快照内存计算连续打卡天数（与 computeStreak 口径一致：今日无记录则从昨天起算） */
function computeStreakFromStats(stats: DailyStat[]): number {
  const byDate = new Map(stats.map((s) => [s.date, s]));
  const today = dateKey();
  const todayStat = byDate.get(today);
  let cursor = todayStat && todayStat.totalCount > 0 ? 0 : -1;
  let streak = 0;
  while (true) {
    const stat = byDate.get(dateKeyOffset(cursor));
    if (!stat || stat.totalCount === 0) break;
    streak++;
    cursor--;
  }
  return streak;
}

export function trendDateLabel(key: string): string {
  return key.slice(5).replace('-', '/');
}

export { dateKeyOffset };
