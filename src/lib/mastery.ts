import type { UserWord } from '@/types';

/**
 * 掌握度分类（仪表盘 / 词表共用，独立模块避免 services 循环依赖）
 *
 * 依据 FSRS 排程间隔（scheduledDays）判定，与答题次数（reps）无关：
 * - 已掌握 = 间隔 ≥ 365 天（下次复习排到一年以后）
 * - 新学中 = 间隔 ≤ 7 天（一周内仍需复习，尚未拉开间隔）
 * - 巩固中 = 7 天 < 间隔 < 365 天
 *
 * 不用 reps 的原因：回炉/重复答题每次都会让 reps +1（ts-fsrs 语义），
 * 新学当天一个词回炉两次 reps 就到 3，会被误判成巩固中；
 * 而回炉不改变 scheduledDays（仍是 1 天），所以按间隔分类天然免疫计数膨胀。
 */
export type MasteryLevel = 'learning' | 'consolidating' | 'mastered';

export function classifyMastery(c: Pick<UserWord, 'scheduledDays'>): MasteryLevel {
  if (c.scheduledDays >= 365) return 'mastered';
  return c.scheduledDays <= 7 ? 'learning' : 'consolidating';
}
