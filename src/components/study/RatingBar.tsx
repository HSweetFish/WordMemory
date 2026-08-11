import { speak } from '@/lib/tts';

interface RatingBarProps {
  onRate: (rating: 1 | 2 | 3 | 4) => void;
  disabled?: boolean;
  /** 答题正误提示（可选）：答对时高亮 Good/Easy */
  correct?: boolean | null;
  /** 场景：learn=新学（还没学，谈何"忘记"），review=复习（已学过，用记忆程度） */
  mode?: 'learn' | 'review';
}

/** 新学场景：按"掌握程度"分层，避免"忘记"这种对未学过的词说不通的措辞 */
const LEARN_RATINGS = [
  { value: 1 as const, label: '没学会', hint: '完全不会', key: '1', cls: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' },
  { value: 2 as const, label: '有印象', hint: '记得一点', key: '2', cls: 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100' },
  { value: 3 as const, label: '学会了', hint: '基本掌握', key: '3', cls: 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100' },
  { value: 4 as const, label: '很熟练', hint: '轻松掌握', key: '4', cls: 'border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100' },
];

/** 复习场景：按记忆程度评分（对已学过的词，"忘记/模糊/记得/熟练"更贴切） */
const REVIEW_RATINGS = [
  { value: 1 as const, label: '忘记', hint: '完全想不起来', key: '1', cls: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' },
  { value: 2 as const, label: '模糊', hint: '有点印象', key: '2', cls: 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100' },
  { value: 3 as const, label: '记得', hint: '能想起来', key: '3', cls: 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100' },
  { value: 4 as const, label: '熟练', hint: '轻松掌握', key: '4', cls: 'border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100' },
];

/** FSRS 四级评分栏（含键盘快捷键 1-4），标签随学习/复习场景变化 */
export default function RatingBar({ onRate, disabled, correct, mode = 'review' }: RatingBarProps) {
  const ratings = mode === 'learn' ? LEARN_RATINGS : REVIEW_RATINGS;

  return (
    <div className="mt-4">
      {correct === true && (
        <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
          ✅ 回答正确！按掌握程度评分
        </div>
      )}
      {correct === false && (
        <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-center text-sm font-medium text-red-600 dark:bg-red-950/50 dark:text-red-300">
          {mode === 'learn' ? '❌ 答错了，选「没学会」会再学一遍' : '❌ 答错了，选 1-2 会再考一遍'}
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {ratings.map((r) => (
          <button
            key={r.value}
            disabled={disabled}
            onClick={() => onRate(r.value)}
            className={`flex flex-col items-center rounded-xl border px-2 py-3 text-sm transition disabled:opacity-40 ${r.cls}`}
          >
            <span className="text-base font-semibold">{r.label}</span>
            <span className="mt-0.5 text-[10px] opacity-70">{r.hint}</span>
            <span className="mt-1 rounded bg-white/60 px-1.5 text-[10px]">{r.key}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 text-center text-xs text-slate-400">
        {mode === 'learn' ? '选 1-2 会再学一遍，3-4 视为掌握，本轮结束后统一回忆确认' : '选 1-2 会再考一遍，3-4 通过并决定下次复习间隔'}
      </div>
    </div>
  );
}

/** 单词发音按钮（释义/例句旁复用） */
export function SpeakButton({ text, label = '🔊' }: { text: string; label?: string }) {
  return (
    <button
      className="ml-1 rounded px-1.5 py-0.5 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-brand-600"
      onClick={(e) => {
        e.stopPropagation();
        speak(text);
      }}
      aria-label={`发音 ${text}`}
    >
      {label}
    </button>
  );
}
