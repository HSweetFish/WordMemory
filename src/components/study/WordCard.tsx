import { useEffect } from 'react';
import type { Word } from '@/types';
import { speak, stopSpeak } from '@/lib/tts';
import AiResult from '@/components/ai/AiResult';
import PosBadge from '@/components/study/PosBadge';
import { meaningLines } from '@/lib/meaning';
import { generateMnemonic } from '@/services/ai';

interface WordCardProps {
  word: Word;
  revealed: boolean;
  onReveal: () => void;
  autoSpeak?: boolean;
}

/** 卡片翻转：正面 = 单词/音标/发音；背面 = 释义/词性/例句 */
export default function WordCard({ word, revealed, onReveal, autoSpeak = true }: WordCardProps) {
  // 自动发音：每次切换单词时朗读（组件随题号 key 重新挂载，无需防重）
  // 注意：不依赖 spokeRef，否则 React StrictMode 下 effect 双调用（mount→cleanup→mount）
  // 会把第一次朗读 cancel 掉且不再重读，导致“开了自动朗读却没声音”。
  useEffect(() => {
    if (!autoSpeak) return;
    speak(word.w);
    return () => stopSpeak();
  }, [word.w, autoSpeak]);

  const phonetic = word.us || word.uk || '';

  return (
    <div className="perspective-1000 select-none">
      <div
        className={`preserve-3d relative h-72 w-full cursor-pointer transition-transform duration-500 ${
          revealed ? 'rotate-y-180' : ''
        }`}
        onClick={onReveal}
        role="button"
        aria-label={revealed ? '显示释义' : '显示单词'}
      >
        {/* 正面：单词 */}
        <div className="backface-hidden absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_8px_24px_-8px_rgba(30,41,59,0.15)] dark:border-slate-700 dark:bg-slate-900">
          <div className="bg-brand-gradient absolute inset-x-0 top-0 h-1" />
          <PosBadge pos={word.pos} className="text-sm" />
          <div className="mt-2 text-center text-4xl font-bold tracking-wide text-slate-800 dark:text-slate-100">
            {word.w}
          </div>
          {phonetic && <div className="mt-3 text-lg text-brand-500 dark:text-brand-400">{phonetic}</div>}
          <button
            className="mt-4 rounded-full bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-600 transition hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300 dark:hover:bg-brand-900/70"
            onClick={(e) => {
              e.stopPropagation();
              speak(word.w);
            }}
          >
            🔊 发音
          </button>
          <div className="absolute bottom-4 text-xs text-slate-300 dark:text-slate-600">点击卡片或按空格显示释义</div>
        </div>

        {/* 背面：释义（按词性分组：每个词性一行「词性+释义」，最后一行例句） */}
        <div className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-brand-100 bg-brand-soft-gradient p-6 shadow-sm dark:border-brand-900/50 dark:bg-slate-900">
          <div className="text-center text-2xl font-bold text-slate-800 dark:text-slate-100">{word.w}</div>
          <div className="mt-3 overflow-y-auto">
            {meaningLines(word).map((g, i) => (
              <div key={i} className="mb-2 rounded-lg bg-white px-3 py-2 text-[15px] leading-relaxed text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                <span className="mr-1.5 font-bold text-brand-600 dark:text-brand-400">{g.pos}</span>
                {g.meaning}
              </div>
            ))}
            {word.ex && word.ex.length > 0 && (
              <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm italic text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
                {word.ex[0]}
              </div>
            )}
          </div>
          {word.freq != null && (
            <div className="absolute right-3 top-3 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              词频 #{word.freq}
            </div>
          )}
          <AiResult
            display="modal"
            title={`${word.w} · AI 助记`}
            buttonLabel="🧠 AI 助记"
            loadingLabel="AI 生成助记中…"
            generate={() => generateMnemonic(word)}
          />
        </div>
      </div>
    </div>
  );
}
