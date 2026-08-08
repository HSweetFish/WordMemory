/** 日期与数字格式化工具 */

/**
 * 应用统一时区：Asia/Shanghai（东八区）。
 * 「天 / 日期」语义固定按东八区计算，不随设备本地时区漂移，
 * 保证每日配额、连续打卡、统计聚合在任何设备上边界一致。
 */
export const APP_TIME_ZONE = 'Asia/Shanghai';

/** 按东八区取日期的 Y/M/D */
function partsInZone(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month'), day: get('day') };
}

/** 日期 key 纯日历运算（YYYY-MM-DD ± N 天，与时区无关） */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** 东八区日期 YYYY-MM-DD */
export function dateKey(d: Date = new Date()): string {
  const { y, m, day } = partsInZone(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 距今 N 天的日期 key（n 可为负，基于东八区今天） */
export function dateKeyOffset(days: number, from: Date = new Date()): string {
  return shiftDateKey(dateKey(from), days);
}

/** 东八区某天的起止时间戳 [start, end]（ms，闭区间） */
export function dayRangeInZone(date: string): [number, number] {
  const [y, m, d] = date.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - 8 * 3600 * 1000; // 东八区 00:00 = UTC 前一日 16:00
  return [start, start + 86_400_000 - 1];
}

/** 时间戳 -> 友好显示（今天 14:30 / 昨天 / 3 天前 / 2026-07-01） */
export function friendlyDate(ts: number): string {
  const d = new Date(ts);
  const today = dateKey();
  const key = dateKey(d);
  if (key === today) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: APP_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `今天 ${hh}:${mm}`;
  }
  if (key === dateKeyOffset(-1)) return '昨天';
  const diffDays = Math.round((Date.now() - ts) / 86400000);
  if (diffDays > 1 && diffDays < 7) return `${diffDays} 天前`;
  return key;
}

/** 剩余时间友好显示 */
export function friendlyDue(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return '已到期';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天后`;
  const months = Math.round(days / 30);
  return `${months} 个月后`;
}

/** 秒 -> mm:ss 或 h:mm:ss */
export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

/** 近 N 天日期序列（含今天），升序 */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dateKeyOffset(-i));
  return out;
}

/** 星期简称（按东八区日历日） */
export function weekdayShort(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return ['日', '一', '二', '三', '四', '五', '六'][dt.getUTCDay()];
}

// ---- 自然周期工具（周/月，严格按日历周期，用于周报/月报）----

/** 日期 key 所在自然周的周一（一周起点，周一到周日） */
export function weekStartOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const offset = (dt.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
  return shiftDateKey(key, -offset);
}

/** 日期 key 所在自然周的 7 天序列（周一 → 周日） */
export function weekDatesOf(key: string): string[] {
  const start = weekStartOf(key);
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(start, i));
}

/** 日期 key 所在自然月（YYYY-MM-01） */
export function monthStartOf(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** 日期 key 所在自然月的全部日期序列（1 号 → 月末） */
export function monthDatesOf(key: string): string[] {
  const [y, m] = key.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = monthStartOf(key);
  return Array.from({ length: daysInMonth }, (_, i) => shiftDateKey(start, i));
}

/** 所在自然周偏移 n 周后的周一（n 可为负，-1 = 上周） */
export function shiftWeek(key: string, n: number): string {
  return shiftDateKey(weekStartOf(key), n * 7);
}

/** 所在自然月偏移 n 月后的 1 号（n 可为负，-1 = 上月） */
export function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** 月标签：2026年7月 */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 周标签：8月3日 - 8月9日（跨年时首尾均带年份） */
export function weekLabel(startKey: string, endKey: string): string {
  const crossYear = startKey.slice(0, 4) !== endKey.slice(0, 4);
  const fmt = (k: string) => {
    const [, m, d] = k.split('-').map(Number);
    return crossYear ? `${k.slice(0, 4)}年${m}月${d}日` : `${m}月${d}日`;
  };
  return `${fmt(startKey)} - ${fmt(endKey)}`;
}
