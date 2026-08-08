import { describe, it, expect } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { scheduler, getScheduler, setSchedulerKind, type SchedulerKind } from '@/fsrs/scheduler';

const NOW = new Date('2026-08-05T00:00:00+08:00');

/** 反复以 Good 复习直到卡片毕业进入 Review */
function graduate(card = scheduler.createCard('apple', ['cet4'], NOW), from = NOW) {
  let cur = card;
  let t = new Date(from);
  for (let i = 0; i < 6 && cur.state !== State.Review; i++) {
    cur = scheduler.review(cur, Rating.Good, t).updated;
    t = new Date(cur.due);
  }
  return { card: cur, lastDue: t };
}

describe('FSRS 排程引擎', () => {
  it('新词卡片初始化：New 状态，due=now', () => {
    const card = scheduler.createCard('apple', ['cet4'], NOW);
    expect(card.wordId).toBe('apple');
    expect(card.state).toBe(State.New);
    expect(card.due).toBe(NOW.getTime());
    expect(card.reps).toBe(0);
    expect(card.bookIds).toEqual(['cet4']);
  });

  it('新词首次评分：直接进入 Review，第一次复习在第二天', () => {
    const card = scheduler.createCard('apple', ['cet4'], NOW);
    const r = scheduler.review(card, Rating.Good, NOW);
    expect(r.state).toBe(State.Review); // 不安排当天学习步骤
    expect(r.scheduledDays).toBe(1); // 第一次复习 = 第二天
    expect(r.updated.due).toBe(NOW.getTime() + 86400000);
    expect(r.updated.lastRating).toBe(Rating.Good);
  });

  it('多轮复习后进入 Review 且间隔递增', () => {
    let { card, lastDue } = graduate();
    expect(card.state).toBe(State.Review);
    expect(card.scheduledDays).toBeGreaterThan(0);
    const firstInterval = card.scheduledDays;
    // 到期后再次 Good：间隔应大于上一次
    card = scheduler.review(card, Rating.Good, lastDue).updated;
    expect(card.scheduledDays).toBeGreaterThan(firstInterval);
    // 再次 Good 间隔继续增大
    const r3 = scheduler.review(card, Rating.Good, new Date(card.due));
    expect(r3.updated.scheduledDays).toBeGreaterThan(card.scheduledDays);
  });

  it('复习答错：遗忘回炉，lapses 与 wrongCount 增加，下次到期排到第二天', () => {
    const { card, lastDue } = graduate();
    expect(card.state).toBe(State.Review);
    const lapsesBefore = card.lapses;
    // 到期后遗忘
    const r = scheduler.review(card, Rating.Again, lastDue);
    expect(r.updated.lapses).toBe(lapsesBefore + 1);
    expect(r.updated.wrongCount).toBe(1);
    // relearning_steps=['1d'] 属长期步骤（≥1440 分钟）：直接毕业为 Review，due = 第二天
    expect(r.updated.due).toBeGreaterThanOrEqual(lastDue.getTime() + 86400000);
  });

  it('复习答错：下次到期至少排到第二天（不再 10 分钟循环）', () => {
    const { card, lastDue } = graduate();
    const r = scheduler.review(card, Rating.Again, lastDue);
    expect(r.updated.due).toBeGreaterThanOrEqual(lastDue.getTime() + 86400000);
    // 回炉后再考 Good：间隔继续拉长，不早于本次到期
    const r2 = scheduler.review(r.updated, Rating.Good, new Date(r.updated.due));
    expect(r2.updated.due).toBeGreaterThan(r.updated.due);
    expect(r2.updated.state).toBe(State.Review);
  });

  it('回忆概率 retention 随时间衰减', () => {
    const { card, lastDue } = graduate();
    expect(card.stability).toBeGreaterThan(0);
    const r1 = scheduler.retention(card, lastDue);
    const r2 = scheduler.retention(card, new Date(lastDue.getTime() + 7 * 86400000));
    expect(r1).toBeGreaterThan(r2);
    expect(r1).toBeGreaterThanOrEqual(0);
    expect(r1).toBeLessThanOrEqual(1);
  });

  it('SM-2 备选实现可用且可切换', () => {
    const cases: { kind: SchedulerKind; expectDays: (d: number) => boolean }[] = [
      { kind: 'fsrs', expectDays: (d) => d >= 0 }, // 学习步骤内为 0
      { kind: 'sm2', expectDays: (d) => d >= 1 }, // SM-2 首轮 1 天
    ];
    for (const { kind, expectDays } of cases) {
      setSchedulerKind(kind);
      const s = getScheduler();
      const card = s.createCard('banana', ['cet4'], NOW);
      const r = s.review(card, Rating.Good, NOW);
      expect(expectDays(r.updated.scheduledDays)).toBe(true);
      // Easy 间隔 >= Good 间隔
      const card2 = s.createCard('cherry', ['cet4'], NOW);
      const rEasy = s.review(card2, Rating.Easy, NOW);
      expect(rEasy.updated.scheduledDays).toBeGreaterThanOrEqual(r.updated.scheduledDays);
    }
    setSchedulerKind('fsrs'); // 恢复默认
  });
});
