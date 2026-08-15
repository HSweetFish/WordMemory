import { useSettings } from '@/stores/settings';
import { getDailyStatsRange, getWeakWords } from '@/services/stats';
import { getMasteryData, getWeakWordData } from '@/services/dashboard';
import { getLearnedWordCount } from '@/services/stats';
import { summarizeStats } from '@/services/dataio';
import { getWord } from '@/services/wordbook';
import {
  dateKey,
  weekDatesOf,
  weekStartOf,
  shiftWeek,
  shiftMonth,
  monthDatesOf,
  weekLabel,
  monthLabel,
} from '@/lib/format';
import type { Word } from '@/types';

/**
 * AI 智能分析模块
 * 兼容 OpenAI Chat Completions 协议的服务商：OpenAI / DeepSeek / 通义千问 / 智谱 GLM / 基元律动 / 自定义
 * API Key 仅保存在浏览器本地（localStorage），请求由浏览器直连（或经自建代理转发）。
 * 注意：基元律动 API 不支持浏览器跨域直连（无 CORS 头），baseUrl 指向同源代理 /tr/v1，
 * 由 vite dev server（开发）或部署端代理（生产）转发到 https://tokenrhythm.studio/v1。
 */

export interface AiProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
}

export const AI_PROVIDERS: Record<string, AiProviderPreset> = {
  openai: { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  deepseek: { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  qwen: { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  zhipu: { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
  tokenrhythm: { id: 'tokenrhythm', name: '基元律动', baseUrl: '/tr/v1', defaultModel: 'deepseek-v4-flash-0731' },
  custom: { id: 'custom', name: '自定义（兼容 OpenAI）', baseUrl: '', defaultModel: '' },
};

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/** 获取当前生效的 Base URL 与模型（含默认值回退） */
export function getAiEndpoint(): { baseUrl: string; model: string } {
  const { settings } = useSettings.getState();
  const preset = AI_PROVIDERS[settings.aiProvider] ?? AI_PROVIDERS.custom;
  return {
    baseUrl: (settings.aiBaseUrl || preset.baseUrl).replace(/\/$/, ''),
    model: settings.aiModel || preset.defaultModel,
  };
}

/** 是否已配置可用的 AI Key */
export function hasAiKey(): boolean {
  return useSettings.getState().settings.aiApiKey.trim().length > 0;
}

/** 调用兼容 OpenAI 的 chat/completions */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const { settings } = useSettings.getState();
  const key = settings.aiApiKey.trim();
  if (!key) throw new Error('请先在「设置」中配置 AI API Key');
  const { baseUrl, model } = getAiEndpoint();
  if (!baseUrl || !model) throw new Error('请先在「设置」中配置 Base URL 与模型');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1200,
      stream: false,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI 请求失败（HTTP ${res.status}）：${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回内容为空');
  return content;
}

/** 测试连接：发一条极简请求验证 Key 与端点
 * 注：maxTokens 给足余量——推理类模型（如 deepseek-v4-flash-0731）会先消耗思考 token，10 会被思考占满导致 content 为空。 */
export async function testAiConnection(): Promise<string> {
  const reply = await chat(
    [
      { role: 'system', content: '只回复两个字：正常' },
      { role: 'user', content: '测试' },
    ],
    { maxTokens: 256 },
  );
  return reply.trim();
}

// ---- 提示词构建（纯函数，便于测试）----

export type ReportKind = 'week' | 'month';

export function buildPeriodReportPrompt(opts: {
  kind: ReportKind;
  /** 周期标签：周报「8月3日 - 8月9日」；月报「2026年7月」 */
  label: string;
  learned: number;
  summary: ReturnType<typeof summarizeStats>;
  mastery: { name: string; value: number }[];
  weak: { name: string; wrongCount: number }[];
  /** 周报为每日明细；月报为按周聚合的概要字符串数组 */
  daily: { date: string; newCount: number; reviewCount: number; correctRate: number }[];
}): ChatMessage[] {
  const title = opts.kind === 'week' ? '本周学习报告' : '本月学习报告';
  const periodDesc =
    opts.kind === 'week'
      ? `本周（${opts.label}，周一至周日）共 7 天`
      : `本月（${opts.label}）共 ${opts.daily.length} 天`;
  const dailyBlock =
    opts.kind === 'week'
      ? `- 每日明细：${JSON.stringify(opts.daily)}`
      : `- 分周概要：${JSON.stringify(opts.daily)}`;
  return [
    {
      role: 'system',
      content:
        '你是一位严谨的英语学习教练，擅长从学习数据中发现规律并给出可执行的建议。回答使用中文，输出 Markdown 格式。',
    },
    {
      role: 'user',
      content: `请根据以下学习数据生成一份「${title}」（约 300 字，Markdown 格式，分四段：总体表现 / 趋势解读 / 薄弱环节 / 下期建议）：
- 统计周期：${periodDesc}
- 累计已学单词：${opts.learned}
- 周期学习汇总：${JSON.stringify(opts.summary)}
- 掌握度分布：${JSON.stringify(opts.mastery)}
- 薄弱词（答错最多）：${JSON.stringify(opts.weak)}
${dailyBlock}`,
    },
  ];
}

export function buildMnemonicPrompt(word: Word): ChatMessage[] {
  const phonetic = [word.us, word.uk].filter(Boolean).join(' / ');
  return [
    {
      role: 'system',
      content: '你是词源学与记忆法专家，擅长用词根词缀拆解、联想记忆、谐音法帮助学习者记单词。回答使用中文，输出 Markdown 格式，简洁不啰嗦，不要使用表格，善用列表与分段。',
    },
    {
      role: 'user',
      content: `为单词「${word.w}」生成记忆助记卡：
- 单词：${word.w} ${phonetic ? `（音标 ${phonetic}）` : ''}
- 释义：${word.m.join('；')}${word.pos ? `（${word.pos}）` : ''}
请给出：1) 词根/词缀拆解（若适用） 2) 联想/谐音记忆法 3) 一个地道的实用例句 4) 一句话记忆口诀`,
    },
  ];
}

export function buildWeakWordsPrompt(words: { word: Word; wrongCount: number; againCount: number; hardCount: number }[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是英语学习诊断专家。根据学生反复答错的单词，分析错误类型（拼写混淆/近义词干扰/生僻义/形近词），并给出针对性的复习策略。回答使用中文，输出 Markdown 格式。格式要求：不要使用表格，不要使用链接，不要使用嵌套列表（子项请平铺为同级列表项），善用短段落与一级列表。',
    },
    {
      role: 'user',
      content: `以下是我最近答错次数最多的单词（含释义与薄弱次数：答错 = 没记住 + 模糊，其中「没记住」是完全想不起来、「模糊」是勉强/不确定），请帮我分析共性问题并给出复习建议：
${words
  .map((w) => {
    const detail = [`答错 ${w.wrongCount} 次`];
    if (w.againCount > 0) detail.push(`其中没记住 ${w.againCount} 次`);
    if (w.hardCount > 0) detail.push(`模糊 ${w.hardCount} 次`);
    return `- ${w.word.w}（${w.word.m.join('；')}）${detail.join('，')}`;
  })
  .join('\n')}`,
    },
  ];
}

// ---- 业务函数 ----

/**
 * 生成周期学习报告（自然周 / 自然月）。
 * offset = 0 表示当前周期，-1 表示上一个周期（上周 / 上月），以此类推。
 * 周报按周一到周日统计；月报按自然月 1 号至月末统计。
 */
export async function generatePeriodReport(kind: ReportKind, offset: number): Promise<string> {
  const today = dateKey();
  const dates =
    kind === 'week' ? weekDatesOf(shiftWeek(today, offset)) : monthDatesOf(shiftMonth(today, offset));
  const fromKey = dates[0];
  const toKey = dates[dates.length - 1];
  const label = kind === 'week' ? weekLabel(fromKey, toKey) : monthLabel(fromKey);

  const [stats, mastery, weak, learned] = await Promise.all([
    getDailyStatsRange(fromKey, toKey),
    getMasteryData(),
    getWeakWordData(8),
    getLearnedWordCount(),
  ]);
  const toDaily = (d: { date: string; newCount: number; reviewCount: number; correctCount: number; totalCount: number }) => ({
    date: d.date,
    newCount: d.newCount,
    reviewCount: d.reviewCount,
    correctRate: d.totalCount > 0 ? Math.round((d.correctCount / d.totalCount) * 100) : 0,
  });
  // 月报按自然周聚合每日明细，控制提示词长度（每月 1-5 周）
  const daily =
    kind === 'week'
      ? stats.map(toDaily)
      : aggregateDailyByWeek(stats.map(toDaily));

  const messages = buildPeriodReportPrompt({
    kind,
    label,
    learned,
    summary: summarizeStats(stats),
    mastery,
    weak,
    daily,
  });
  return chat(messages, { maxTokens: 1600 });
}

/** 按自然周聚合每日明细（月报用）：[{date: 第N周, newCount, reviewCount, correctRate}] */
export function aggregateDailyByWeek(
  daily: { date: string; newCount: number; reviewCount: number; correctRate: number }[],
): { date: string; newCount: number; reviewCount: number; correctRate: number }[] {
  const weeks: { key: string; newCount: number; reviewCount: number; correct: number; days: number }[] = [];
  for (const d of daily) {
    const wk = weekStartOf(d.date);
    let w = weeks.find((x) => x.key === wk);
    if (!w) {
      w = { key: wk, newCount: 0, reviewCount: 0, correct: 0, days: 0 };
      weeks.push(w);
    }
    w.newCount += d.newCount;
    w.reviewCount += d.reviewCount;
    w.correct += d.correctRate;
    w.days += 1;
  }
  return weeks.map((w, i) => ({
    date: `第${i + 1}周`,
    newCount: w.newCount,
    reviewCount: w.reviewCount,
    correctRate: w.days > 0 ? Math.round(w.correct / w.days) : 0,
  }));
}

/** 为单词生成 AI 助记卡 */
export async function generateMnemonic(word: Word): Promise<string> {
  return chat(buildMnemonicPrompt(word), { maxTokens: 800 });
}

/** 薄弱词智能分析 */
export async function analyzeWeakWords(): Promise<string> {
  const weak = await getWeakWords(10);
  const words = (await Promise.all(weak.map((w) => getWord(w.wordId)))).filter((w): w is Word => !!w);
  if (words.length === 0) throw new Error('暂无可分析的薄弱词');
  const items = weak
    .map((w) => ({
      word: words.find((x) => x.w === w.wordId)!,
      wrongCount: w.wrongCount,
      againCount: w.againCount,
      hardCount: w.hardCount,
    }))
    .filter((it) => !!it.word);
  return chat(buildWeakWordsPrompt(items), { maxTokens: 1200 });
}
