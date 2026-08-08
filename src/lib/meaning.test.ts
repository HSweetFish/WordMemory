import { describe, it, expect } from 'vitest';
import { meaningLines } from './meaning';

describe('释义按词性分组 meaningLines', () => {
  const word = (pos: string | undefined, m: string[]) => ({ pos, m });

  it('干净型（cet4）：pos 字段 + 单个释义 → 一行', () => {
    const lines = meaningLines(word('n.', ['活动； 活力； 行动']));
    expect(lines).toEqual([{ pos: 'n.', meaning: '活动； 活力； 行动' }]);
  });

  it('混排型（coca2w）：释义内嵌多个词性标记 → 按词性分行', () => {
    const lines = meaningLines(word('v.', ['v.行动,表现,表演,起作用n.行为,行动,法案，法令,短节目']));
    expect(lines).toEqual([
      { pos: 'v.', meaning: '行动,表现,表演,起作用' },
      { pos: 'n.', meaning: '行为,行动,法案，法令,短节目' },
    ]);
  });

  it('多词性拆分：vt./vi./adj. 依次分组', () => {
    const lines = meaningLines(word('n.', ['n.熊,卖空的人vt.忍受,承担vi.生（孩子）adj.跌价的']));
    expect(lines.map((l) => l.pos)).toEqual(['n.', 'vt.', 'vi.', 'adj.']);
    expect(lines[1].meaning).toBe('忍受,承担');
    expect(lines[2].meaning).toBe('生（孩子）');
  });

  it('单词性内嵌（record）：文本以词性标记开头 → 按该词性显示', () => {
    const lines = meaningLines(word('n.', ['n.记录，记载,档案，履历,唱片,最高纪录']));
    expect(lines).toEqual([{ pos: 'n.', meaning: '记录，记载,档案，履历,唱片,最高纪录' }]);
  });

  it('无内嵌词性也无 pos → 兜底单行', () => {
    const lines = meaningLines(word(undefined, ['苹果']));
    expect(lines).toEqual([{ pos: '词', meaning: '苹果' }]);
  });

  it('多释义元素合并后解析（toefl 格式）', () => {
    const lines = meaningLines(word('n.', ['作讲话； 写姓名地址', '地址；讲话']));
    expect(lines).toEqual([{ pos: 'n.', meaning: '作讲话； 写姓名地址；地址；讲话' }]);
  });

  it('多词性无内嵌标记（自定义书）：释义段按词性顺序比例分列', () => {
    const lines = meaningLines(word('n. v.', ['奖', '奖品', '授予']));
    expect(lines).toEqual([
      { pos: 'n.', meaning: '奖；奖品' },
      { pos: 'v.', meaning: '授予' },
    ]);
  });

  it('多词性无内嵌标记：段数 = 词性数时一一对应', () => {
    const lines = meaningLines(word('n./v.', ['鼓掌', '拍手']));
    expect(lines).toEqual([
      { pos: 'n.', meaning: '鼓掌' },
      { pos: 'v.', meaning: '拍手' },
    ]);
  });

  it('多词性但释义段不足：无法归属，退回合并显示', () => {
    const lines = meaningLines(word('adj./v.', ['裸体的']));
    expect(lines).toEqual([{ pos: 'adj./v.', meaning: '裸体的' }]);
  });

  it('bare 型：3 段分给 2 个词性，按比例 2:1 分列', () => {
    const lines = meaningLines(word('adj./v.', ['裸体的', '裸露的', '光秃秃的']));
    expect(lines).toEqual([
      { pos: 'adj.', meaning: '裸体的；裸露的' },
      { pos: 'v.', meaning: '光秃秃的' },
    ]);
  });
});
