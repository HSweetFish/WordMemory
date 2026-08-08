import { useState } from 'react';
import type { Word } from '@/types';
import { speak } from '@/lib/tts';
import { ui } from '@/lib/ui';
import { meaningLines } from '@/lib/meaning';

interface SpellProps {
  word: Word;
  onAnswered: (correct: boolean) => void;
}

/** 拼写模式：给出释义与音标，输入单词 */
export default function Spell({ word, onAnswered }: SpellProps) {
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState(false);

  const correct = input.trim().toLowerCase() === word.w.toLowerCase();
  const isAnswered = checked;

  const check = () => {
    if (!input.trim()) return;
    setChecked(true);
    onAnswered(correct);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!checked) check();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_8px_24px_-8px_rgba(30,41,59,0.12)] dark:border-slate-700 dark:bg-slate-900">
      <div className="bg-brand-gradient absolute inset-x-0 top-0 h-1" />
      <div className="text-center text-xs text-slate-400 dark:text-slate-500">根据释义拼写单词</div>
      <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-center dark:bg-slate-800/60">
        <div className="space-y-1">
          {meaningLines(word).map((g, i) => (
            <div key={i} className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
              <span className="font-bold text-brand-600 dark:text-brand-400">{g.pos}</span>
              <span className="ml-1">{g.meaning}</span>
            </div>
          ))}
        </div>
        {word.us && <div className="mt-1 text-sm text-slate-400 dark:text-slate-500">[{word.us}]</div>}
      </div>

      <div className="mt-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={isAnswered}
          placeholder="输入单词后回车"
          autoFocus
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-xl font-medium tracking-wide text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-900/40 dark:disabled:bg-slate-800/50"
        />
      </div>

      {isAnswered ? (
        <div className="mt-3 text-center">
          <div className={`text-lg font-semibold ${correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {correct ? '✅ 拼写正确' : '❌ 拼写错误'}
          </div>
          <div className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{word.w}</div>
        </div>
      ) : (
        <div className="mt-3 flex justify-center">
          <button
            onClick={check}
            disabled={!input.trim()}
            className={ui.btnPrimaryLg}
          >
            检查
          </button>
          <button
            className="ml-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={() => speak(word.w)}
            title="听发音提示"
          >
            🔊 听发音
          </button>
        </div>
      )}
    </div>
  );
}
