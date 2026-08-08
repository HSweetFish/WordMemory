import { Rating } from 'ts-fsrs';
import type { ReviewLog } from '@/types';
import { dateKey, dateKeyOffset, APP_TIME_ZONE } from '@/lib/format';

/**
 * 记忆历史工具：四级评分展示元数据 + 答题记录按天分组。
 * 用户确认：按 FSRS 四个选项原样记录（Again/Hard/Good/Easy），不合并。
 */

/** 四级评分 → 展示元数据（标签 / 图标 / 徽章样式 / 时间线圆点颜色） */
export const RATING_META: Record<
  number,
  { label: string; en: string; emoji: string; badge: string; dot: string }
> = {
  [Rating.Again]: {
    label: '忘记',
    en: 'Again',
    emoji: '❌',
    badge: 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300',
    dot: 'bg-red-500',
  },
  [Rating.Hard]: {
    label: '勉强',
    en: 'Hard',
    emoji: '⚠️',
    badge: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  [Rating.Good]: {
    label: '熟练',
    en: 'Good',
    emoji: '✅',
    badge: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  [Rating.Easy]: {
    label: '轻松',
    en: 'Easy',
    emoji: '🌟',
    badge: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
};

/** 答题模式 → 中文标签 */
export const MODE_LABEL: Record<ReviewLog['mode'], string> = {
  learn: '新学',
  review: '复习',
  random: '抽查',
};

/** 按天分组结果 */
export interface DayGroup {
  /** YYYY-MM-DD（东八区） */
  date: string;
  /** 友好日期头：今天 / 昨天 / M月D日 / YYYY-MM-DD */
  label: string;
  /** 组内记录（按时间升序） */
  items: ReviewLog[];
  /** 该天是否含新学记录（mode=learn） */
  isLearningDay: boolean;
}

/** 日期 key → 友好标签（今天 / 昨天 / M月D日 / YYYY-MM-DD） */
export function dayLabel(key: string): string {
  if (key === dateKey()) return '今天';
  if (key === dateKeyOffset(-1)) return '昨天';
  const [y, m, d] = key.split('-').map(Number);
  const now = new Date();
  return y === now.getFullYear() ? `${m}月${d}日` : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 时间戳 → HH:mm（东八区） */
export function timeHM(ts: number): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  return `${parts.find((p) => p.type === 'hour')?.value ?? '00'}:${parts.find((p) => p.type === 'minute')?.value ?? '00'}`;
}

/**
 * 答题记录按东八区日期分组：组间新→旧，组内时间升序。
 * 新学日标记：该天存在 mode=learn 记录。
 */
export function groupLogsByDay(logs: ReviewLog[]): DayGroup[] {
  const sorted = [...logs].sort((a, b) => a.reviewedAt - b.reviewedAt);
  const map = new Map<string, ReviewLog[]>();
  for (const log of sorted) {
    const d = dateKey(new Date(log.reviewedAt));
    const arr = map.get(d);
    if (arr) arr.push(log);
    else map.set(d, [log]);
  }
  return [...map.entries()]
    .map(([date, items]) => ({
      date,
      label: dayLabel(date),
      items,
      isLearningDay: items.some((l) => l.mode === 'learn'),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
