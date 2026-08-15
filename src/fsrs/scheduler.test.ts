import { describe, it, expect } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { scheduler, getScheduler, setSchedulerKind, type SchedulerKind } from '@/fsrs/scheduler';
import { dateKey, shiftDateKey, dayRangeInZone } from '@/lib/format';

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

  it('新词首次评分：直接进入 Review，第一次复习排到「明天 0 点」', () => {
    const card = scheduler.createCard('apple', ['cet4'], NOW);
    const r = scheduler.review(card, Rating.Good, NOW);
    expect(r.state).toBe(State.Review); // 不安排当天学习步骤
    expect(r.scheduledDays).toBe(1); // 第一次复习 = 第二天
    // NOW 恰好是东八区 0 点 → 明天 0 点 = 24 小时后（旧断言在此场景下数值碰巧相等）
    const tomorrowStart = dayRangeInZone(shiftDateKey(dateKey(NOW), 1))[0];
    expect(r.updated.due).toBe(tomorrowStart);
    expect(r.updated.lastRating).toBe(Rating.Good);
  });

  it('晚上学的新词：首次复习提前到「明天 0 点」，而非 24 小时后', () => {
    const evening = new Date('2026-08-05T21:00:00+08:00'); // 晚上 9 点学习
    const card = scheduler.createCard('apple', ['cet4'], evening);
    const r = scheduler.review(card, Rating.Good, evening);
    const tomorrowStart = dayRangeInZone(shiftDateKey(dateKey(evening), 1))[0];
    expect(r.updated.due).toBe(tomorrowStart);
    // 明天 0 点 < 24 小时后（次日 21 点）——早上起来就能复习，不用等到晚上
    expect(r.updated.due).toBeLessThan(evening.getTime() + 86400000);
  });

  it('晚上复习的到期词：due 对齐到「N 天后 0 点」，而非精确时刻', () => {
    // 8/9 21:37 学的词，间隔 2 天 → 旧逻辑 due=8/11 21:37（上午看不到、晚上才冒出来）
    const evening = new Date('2026-08-09T21:37:00+08:00');
    const card = scheduler.createCard('reactor', ['cet4'], evening);
    // 首次评分 → Review，due=8/10 0 点
    const first = scheduler.review(card, Rating.Good, evening);
    expect(first.updated.due).toBe(dayRangeInZone('2026-08-10')[0]);
    // 8/10 0 点到期后复习（间隔应 ≥2 天）→ due 对齐到 8/12 之后的某日 0 点，而非 8/10+2 天的精确时刻
    const second = scheduler.review(first.updated, Rating.Good, new Date(first.updated.due));
    const dueDate = dateKey(new Date(second.updated.due));
    expect(new Date(second.updated.due).getTime()).toBe(dayRangeInZone(dueDate)[0]); // 是该日 0 点
    expect(second.updated.scheduledDays).toBeGreaterThanOrEqual(2);
    // 且不早于 8/12 0 点（至少 2 天后）
    expect(second.updated.due).toBeGreaterThanOrEqual(dayRangeInZone('2026-08-12')[0]);
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
