import { parsePos } from '@/lib/pos';

interface PosBadgeProps {
  pos?: string;
  /** 无词性时的占位符（默认 '·'）；传 null 则不渲染任何内容 */
  empty?: string | null;
  className?: string;
}

/** 词性徽章配色：按词性类型着色（n. 蓝 / 动词 绿 / adj. 紫 / adv. 橙 / 其他 灰） */
const POS_COLORS: Record<string, string> = {
  'n.': 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300',
  'v.': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
  'vt.': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
  'vi.': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
  'adj.': 'bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300',
  'adv.': 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300',
  'prep.': 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300',
  'conj.': 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300',
  'pron.': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  'num.': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  'aux.': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  'int.': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  'art.': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const FALLBACK = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';

/** 词性徽章：单/多词性统一渲染（n.&v. → n. v. 两个徽章），无词性显示占位符 */
export default function PosBadge({ pos, empty = '·', className = '' }: PosBadgeProps) {
  const parts = parsePos(pos);
  if (parts.length === 0) {
    if (empty == null) return null;
    return (
      <span className={`text-xs text-slate-300 dark:text-slate-600 ${className}`}>{empty}</span>
    );
  }
  return (
    <span className={`inline-flex flex-wrap items-center justify-center gap-1 ${className}`}>
      {parts.map((p) => (
        <span
          key={p}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${POS_COLORS[p] ?? FALLBACK}`}
        >
          {p}
        </span>
      ))}
    </span>
  );
}
