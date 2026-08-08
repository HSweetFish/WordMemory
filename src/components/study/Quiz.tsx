import { useEffect, useState } from 'react';
import type { Word } from '@/types';
import { getRandomWords } from '@/services/wordbook';
import { speak } from '@/lib/tts';
import { meaningLines } from '@/lib/meaning';

interface QuizProps {
  word: Word;
  onAnswered: (correct: boolean) => void;
  /** 通过 key 变化重置状态 */
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 四选一：给出单词，从 4 个释义中选出正确项（选项带词性，便于区分多词性词的不同释义） */
export default function Quiz({ word, onAnswered }: QuizProps) {
  const [options, setOptions] = useState<{ word: Word; correct: boolean }[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setSelected(null);
    (async () => {
      const distractors = await getRandomWords(3, new Set([word.w.toLowerCase()]));
      const opts = shuffle([
        { word, correct: true },
        ...distractors.slice(0, 3).map((d) => ({ word: d, correct: false })),
      ]);
      if (!cancelled) setOptions(opts);
    })();
    return () => {
      cancelled = true;
    };
  }, [word.w]);

  if (!options) {
    return (
      <div className="flex h-56 items-center justify-center text-slate-400">出题中…</div>
    );
  }

  const isAnswered = selected !== null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_8px_24px_-8px_rgba(30,41,59,0.12)] dark:border-slate-700 dark:bg-slate-900">
      <div className="bg-brand-gradient absolute inset-x-0 top-0 h-1" />
      <div className="text-center text-xs text-slate-400 dark:text-slate-500">选择正确释义</div>
      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="text-3xl font-bold text-slate-800 dark:text-slate-100">{word.w}</span>
        <button
          className="rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-600 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300 dark:hover:bg-brand-900/70"
          onClick={() => speak(word.w)}
        >
          🔊
        </button>
      </div>
      {word.us && <div className="mt-1 text-center text-sm text-slate-400 dark:text-slate-500">{word.us}</div>}

      <div className="mt-5 grid gap-2">
        {options.map((opt, i) => {
          let cls = 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800';
          if (isAnswered) {
            if (opt.correct) cls = 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
            else if (i === selected) cls = 'border-red-300 bg-red-50 text-red-600 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300';
            else cls = 'border-slate-100 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-500';
          }
          const lines = meaningLines(opt.word);
          return (
            <button
              key={i}
              disabled={isAnswered}
              onClick={() => {
                setSelected(i);
                onAnswered(opt.correct);
              }}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${cls}`}
            >
              <span className="mr-2 text-xs text-slate-400 dark:text-slate-500">{String.fromCharCode(65 + i)}.</span>
              <span className="flex flex-col gap-0.5">
                {lines.map((g, gi) => (
                  <span key={gi}>
                    <span className="font-bold text-brand-600 dark:text-brand-400">{g.pos}</span>
                    <span className="ml-1">{g.meaning}</span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
