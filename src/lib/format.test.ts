import { describe, it, expect } from 'vitest';
import {
  weekStartOf,
  weekDatesOf,
  monthDatesOf,
  shiftWeek,
  shiftMonth,
  weekLabel,
  monthLabel,
} from '@/lib/format';

describe('自然周期工具（周/月）', () => {
  it('weekStartOf：周一为一周起点', () => {
    // 2026-08-03 是周一；2026-08-07 是周五
    expect(weekStartOf('2026-08-03')).toBe('2026-08-03');
    expect(weekStartOf('2026-08-07')).toBe('2026-08-03');
    expect(weekStartOf('2026-08-09')).toBe('2026-08-03'); // 周日仍属本周
  });

  it('weekDatesOf：周一到周日 7 天序列', () => {
    expect(weekDatesOf('2026-08-07')).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
  });

  it('weekDatesOf：跨月自然周（7月27日-8月2日）', () => {
    expect(weekDatesOf('2026-07-30')).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('monthDatesOf：2 月 28 天（2026 非闰年）', () => {
    expect(monthDatesOf('2026-02-10')).toHaveLength(28);
    expect(monthDatesOf('2026-02-10')[0]).toBe('2026-02-01');
    expect(monthDatesOf('2026-02-10')[27]).toBe('2026-02-28');
  });

  it('monthDatesOf：8 月 31 天', () => {
    expect(monthDatesOf('2026-08-07')).toHaveLength(31);
    expect(monthDatesOf('2026-08-07')[30]).toBe('2026-08-31');
  });

  it('shiftWeek：上周 / 下周', () => {
    expect(shiftWeek('2026-08-07', -1)).toBe('2026-07-27'); // 上周一
    expect(shiftWeek('2026-08-07', 1)).toBe('2026-08-10'); // 下周一
    expect(shiftWeek('2026-08-03', 0)).toBe('2026-08-03'); // 本周一
  });

  it('shiftMonth：上月 / 下月（跨年）', () => {
    expect(shiftMonth('2026-08-07', -1)).toBe('2026-07-01');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01'); // 跨年
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-08-07', 0)).toBe('2026-08-01');
  });

  it('weekLabel：同月 / 跨月 / 跨年', () => {
    expect(weekLabel('2026-08-03', '2026-08-09')).toBe('8月3日 - 8月9日');
    expect(weekLabel('2026-07-27', '2026-08-02')).toBe('7月27日 - 8月2日');
    expect(weekLabel('2025-12-29', '2026-01-04')).toBe('2025年12月29日 - 2026年1月4日');
  });

  it('monthLabel', () => {
    expect(monthLabel('2026-08-01')).toBe('2026年8月');
    expect(monthLabel('2026-08-31')).toBe('2026年8月');
  });
});
