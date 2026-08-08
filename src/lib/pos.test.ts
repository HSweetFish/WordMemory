import { describe, it, expect } from 'vitest';
import { parsePos } from './pos';

describe('parsePos 词性解析', () => {
  it('单词性原样返回', () => {
    expect(parsePos('vt.')).toEqual(['vt.']);
    expect(parsePos('adj.')).toEqual(['adj.']);
  });

  it('& 分隔的多词性拆分', () => {
    expect(parsePos('n.&v.')).toEqual(['n.', 'v.']);
    expect(parsePos('n. & v.')).toEqual(['n.', 'v.']);
  });

  it('斜杠分隔拆分', () => {
    expect(parsePos('n./v.')).toEqual(['n.', 'v.']);
    expect(parsePos('n. / v.')).toEqual(['n.', 'v.']);
    expect(parsePos('adj.／adv.')).toEqual(['adj.', 'adv.']);
  });

  it('逗号/顿号/分号分隔拆分', () => {
    expect(parsePos('n.,v.')).toEqual(['n.', 'v.']);
    expect(parsePos('adj.、adv.')).toEqual(['adj.', 'adv.']);
    expect(parsePos('vt.;vi.')).toEqual(['vt.', 'vi.']);
  });

  it('空值返回空数组', () => {
    expect(parsePos(undefined)).toEqual([]);
    expect(parsePos('')).toEqual([]);
    expect(parsePos('   ')).toEqual([]);
  });

  it('不去除词性内部的点号', () => {
    expect(parsePos('n.')).toEqual(['n.']);
  });
});
