import { describe, it, expect } from 'vitest';
import { Rating } from 'ts-fsrs';
import type { ReviewLog } from '@/types';
import { RATING_META, MODE_LABEL, groupLogsByDay, dayLabel } from '@/lib/history';
import { dateKey } from '@/lib/format';

function log(partial: Partial<ReviewLog> & { reviewedAt: number; rating: Rating }): ReviewLog {
  return {
    wordId: 'apple',
    elapsedMs: 3000,
    scheduledDays: 1,
    state: 0,
    mode: 'review',
    ...partial,
  };
}

describe('记忆历史工具', () => {
  it('四级评分都有展示元数据（忘记/勉强/熟练/轻松）', () => {
    expect(RATING_META[Rating.Again].label).toBe('忘记');
    expect(RATING_META[Rating.Hard].label).toBe('勉强');
    expect(RATING_META[Rating.Good].label).toBe('熟练');
    expect(RATING_META[Rating.Easy].label).toBe('轻松');
    expect(Object.keys(RATING_META).length).toBe(4);
  });

  it('模式标签：学习/复习/抽查', () => {
    expect(MODE_LABEL.learn).toBe('新学');
    expect(MODE_LABEL.review).toBe('复习');
    expect(MODE_LABEL.random).toBe('抽查');
  });

  it('按东八区日期分组：组间新→旧、组内时间升序、新学日标记', () => {
    const d1 = new Date('2026-08-01T02:00:00+08:00').getTime();
    const d2 = new Date('2026-08-01T10:30:00+08:00').getTime();
    const d3 = new Date('2026-08-02T20:00:00+08:00').getTime();
    const groups = groupLogsByDay([
      log({ reviewedAt: d3, rating: Rating.Good }),
      log({ reviewedAt: d1, rating: Rating.Again, mode: 'learn' }),
      log({ reviewedAt: d2, rating: Rating.Good }),
    ]);

    expect(groups.map((g) => g.date)).toEqual(['2026-08-02', '2026-08-01']);
    expect(groups[1].items.map((l) => l.rating)).toEqual([Rating.Again, Rating.Good]);
    expect(groups[1].isLearningDay).toBe(true);
    expect(groups[0].isLearningDay).toBe(false);
  });

  it('东八区边界：UTC 前一日 16:00 属于当天（00:00）', () => {
    // 2026-08-01 00:00 +08:00 = 2026-07-31T16:00:00Z
    const atMidnight = Date.parse('2026-07-31T16:00:00Z');
    const groups = groupLogsByDay([log({ reviewedAt: atMidnight, rating: Rating.Good })]);
    expect(groups[0].date).toBe('2026-08-01');
  });

  it('dayLabel：今天 / 昨天 / M月D日 / 跨年带年份', () => {
    expect(dayLabel(dateKey())).toBe('今天');
    const y = new Date().getFullYear();
    expect(dayLabel(`${y}-08-01`)).toMatch(/月/);
    expect(dayLabel(`${y - 1}-12-31`)).toBe(`${y - 1}-12-31`);
  });
});
