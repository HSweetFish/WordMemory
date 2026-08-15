import { describe, it, expect } from 'vitest';
import { mdToHtml } from '@/lib/markdown';
import { buildPeriodReportPrompt, buildMnemonicPrompt, buildWeakWordsPrompt, aggregateDailyByWeek, AI_PROVIDERS } from '@/services/ai';
import type { Word } from '@/types';

describe('AI 模块', () => {
  it('服务商预设完整（OpenAI 兼容端点）', () => {
    expect(AI_PROVIDERS.openai.baseUrl).toContain('openai.com');
    expect(AI_PROVIDERS.deepseek.baseUrl).toContain('deepseek.com');
    expect(AI_PROVIDERS.qwen.baseUrl).toContain('dashscope');
    expect(AI_PROVIDERS.zhipu.baseUrl).toContain('bigmodel');
    expect(AI_PROVIDERS.tokenrhythm.baseUrl).toBe('/tr/v1'); // 同源代理路径（TokenRhythm 不支持浏览器直连 CORS）
    expect(AI_PROVIDERS.tokenrhythm.defaultModel).toBe('deepseek-v4-flash-0731');
    expect(AI_PROVIDERS.custom.baseUrl).toBe('');
  });

  it('周报提示词包含周期标签与学习数据', () => {
    const messages = buildPeriodReportPrompt({
      kind: 'week',
      label: '8月3日 - 8月9日',
      learned: 120,
      summary: { activeDays: 5, totalNew: 40, totalReview: 80, totalAnswered: 120, correctRate: 78 },
      mastery: [{ name: '已掌握', value: 60 }],
      weak: [{ name: 'abandon', wrongCount: 3 }],
      daily: [{ date: '2026-08-05', newCount: 10, reviewCount: 20, correctRate: 80 }],
    });
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('本周学习报告');
    expect(messages[1].content).toContain('8月3日 - 8月9日');
    expect(messages[1].content).toContain('abandon');
    expect(messages[1].content).toContain('120');
    expect(messages[1].content).toContain('每日明细');
  });

  it('月报提示词使用「本月学习报告」与分周概要', () => {
    const messages = buildPeriodReportPrompt({
      kind: 'month',
      label: '2026年7月',
      learned: 300,
      summary: { activeDays: 20, totalNew: 100, totalReview: 200, totalAnswered: 300, correctRate: 82 },
      mastery: [],
      weak: [],
      daily: [
        { date: '第1周', newCount: 25, reviewCount: 50, correctRate: 80 },
        { date: '第2周', newCount: 30, reviewCount: 60, correctRate: 84 },
      ],
    });
    expect(messages[1].content).toContain('本月学习报告');
    expect(messages[1].content).toContain('2026年7月');
    expect(messages[1].content).toContain('分周概要');
    expect(messages[1].content).toContain('第1周');
  });

  it('aggregateDailyByWeek：跨自然周聚合为第N周概要', () => {
    const daily = [
      { date: '2026-08-03', newCount: 5, reviewCount: 10, correctRate: 80 }, // 周一
      { date: '2026-08-04', newCount: 7, reviewCount: 12, correctRate: 75 }, // 周二
      { date: '2026-08-10', newCount: 3, reviewCount: 8, correctRate: 88 }, // 下周一
    ];
    const out = aggregateDailyByWeek(daily);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: '第1周', newCount: 12, reviewCount: 22, correctRate: 78 });
    expect(out[1]).toMatchObject({ date: '第2周', newCount: 3, reviewCount: 8, correctRate: 88 });
  });

  it('助记提示词包含单词信息', () => {
    const word: Word = { w: 'serendipity', m: ['机缘巧合'], pos: 'n.', freq: 5000, books: [] };
    const messages = buildMnemonicPrompt(word);
    expect(messages[1].content).toContain('serendipity');
    expect(messages[1].content).toContain('机缘巧合');
    expect(messages[1].content).toContain('词根');
  });

  it('Markdown 渲染：转义 + 基本格式', () => {
    const html = mdToHtml('# 标题\n**加粗** 与 *斜体*\n- 列表项\n1. 有序项\n`code`');
    expect(html).toContain('<h2>标题</h2>');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<code>code</code>');
  });

  it('Markdown 渲染：剥离 HTML 标签防 XSS', () => {
    const html = mdToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('script');
    expect(html).toContain('alert(1)');
  });

  it('薄弱词提示词包含诊断要求', () => {
    const word: Word = { w: 'affect', m: ['影响'], pos: 'v.', freq: 100, books: [] };
    const messages = buildWeakWordsPrompt([{ word, wrongCount: 5, againCount: 3, hardCount: 2 }]);
    expect(messages[1].content).toContain('affect');
    expect(messages[1].content).toContain('5');
    expect(messages[1].content).toContain('没记住 3 次');
    expect(messages[1].content).toContain('模糊 2 次');
    expect(messages[0].content).toContain('诊断');
  });
});
