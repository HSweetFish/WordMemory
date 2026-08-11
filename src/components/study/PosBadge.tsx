import { parsePos } from '@/lib/pos';

interface PosBadgeProps {
  pos?: string;
  /** 无词性时的占位符（默认 '·'）；传 null 则不渲染任何内容 */
  empty?: string | null;
  className?: string;
}

/**
 * 词性徽章配色：仅使用品牌体系内色（sky 主色 / emerald 成功 / amber 警告 / slate 中性）。
 * n. 蓝、动词 绿、修饰词（adj./adv.）amber、稀有词性（prep./conj./pron./num./aux./int./art.）灰。
 */
const POS_COLORS: Record<string, string> = {
  'n.': 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300',
  'v.': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
  'vt.': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
  'vi.': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
  'adj.': 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300',
  'adv.': 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300',
  'prep.': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  'conj.': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
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
