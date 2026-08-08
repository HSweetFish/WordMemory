import { describe, it, expect } from 'vitest';
import { classifyMastery } from './mastery';

describe('掌握度分类（按 FSRS 排程间隔）', () => {
  const card = (scheduledDays: number) => ({ scheduledDays });

  it('间隔 ≥ 365 天 → 已掌握', () => {
    expect(classifyMastery(card(365))).toBe('mastered');
    expect(classifyMastery(card(400))).toBe('mastered');
    expect(classifyMastery(card(730))).toBe('mastered');
  });

  it('间隔 ≤ 7 天 → 新学中（回炉不改变间隔，新学词不会误判）', () => {
    expect(classifyMastery(card(1))).toBe('learning');
    expect(classifyMastery(card(3))).toBe('learning');
    expect(classifyMastery(card(7))).toBe('learning');
  });

  it('7 < 间隔 < 365 天 → 巩固中', () => {
    expect(classifyMastery(card(8))).toBe('consolidating');
    expect(classifyMastery(card(30))).toBe('consolidating');
    expect(classifyMastery(card(364))).toBe('consolidating');
  });

  it('与答题次数 reps 无关：回炉多次但间隔仍 1 天 → 新学中', () => {
    // 模拟新学当天回炉 3 次（reps=3），但间隔仍 1 天
    const c = { reps: 3, scheduledDays: 1 };
    expect(classifyMastery(c)).toBe('learning');
  });
});
