import { describe, it, expect } from 'vitest';
import { Rating } from 'ts-fsrs';
import type { ReviewLog } from '@/types';
import { RATING_META, ratingLabel, MODE_LABEL, groupLogsByDay, dayLabel } from '@/lib/history';
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
  it('四级评分都有展示元数据（忘记/模糊/记得/熟练，与复习按钮一致）', () => {
    expect(RATING_META[Rating.Again].label).toBe('忘记');
    expect(RATING_META[Rating.Hard].label).toBe('模糊');
    expect(RATING_META[Rating.Good].label).toBe('记得');
    expect(RATING_META[Rating.Easy].label).toBe('熟练');
    expect(Object.keys(RATING_META).length).toBe(4);
  });

  it('评分标签按场景区分：学习用「没学会/有印象/学会了/很熟练」，复习/抽查用「忘记/模糊/记得/熟练」', () => {
    expect(ratingLabel('learn', Rating.Again)).toBe('没学会');
    expect(ratingLabel('learn', Rating.Hard)).toBe('有印象');
    expect(ratingLabel('learn', Rating.Good)).toBe('学会了');
    expect(ratingLabel('learn', Rating.Easy)).toBe('很熟练');
    expect(ratingLabel('review', Rating.Again)).toBe('忘记');
    expect(ratingLabel('review', Rating.Hard)).toBe('模糊');
    expect(ratingLabel('review', Rating.Good)).toBe('记得');
    expect(ratingLabel('review', Rating.Easy)).toBe('熟练');
    expect(ratingLabel('random', Rating.Good)).toBe('记得');
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
