import { useEffect, useState } from 'react';
import { useSession } from '@/stores/session';
import { useSettings } from '@/stores/settings';
import { getTodaySummary, type TodaySummary } from '@/services/stats';
import { countNewWords } from '@/services/wordbook';

/**
 * 今日进度悬浮窗（学习/复习页右侧，古早挂窗广告样式）：
 * 答题过程中实时显示「今日新学 / 今日复习」总进度，弥补只看得到本组进度的盲区。
 * - 新学分母 = min(每日配额, 词库剩余未学)，词库学完时退化为已学量（0/0）
 * - 复习分母 = 今日已复习 + 当前待复习（实际到期量）
 * 完成页（finished）已有今日情况卡片，此窗自动隐藏，避免重复。
 */
export default function TodayProgressPanel() {
  const session = useSession();
  const { settings } = useSettings();
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [remainingNew, setRemainingNew] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);

  // 每次评分/回忆确认后刷新今日统计（attemptCount 每次作答都 +1，落库完成后才更新 store）
  useEffect(() => {
    if (session.status !== 'running') return;
    let cancelled = false;
    void getTodaySummary().then((s) => {
      if (!cancelled) setToday(s);
    });
    return () => {
      cancelled = true;
    };
  }, [session.attemptCount, session.correctCount, session.status, session.mode]);

  // 词库剩余未学词数（学习进度分母）
  // 每次作答后刷新：学习会消耗剩余未学，若只在挂载时取一次（快照），
  // 学到中途剩余数不会下降，与今日已学相加会虚高（如已学 140、剩余快照 44 → 分母 184）
  useEffect(() => {
    if (settings.activeBooks.length === 0) {
      setRemainingNew(0);
      return;
    }
    let cancelled = false;
    void countNewWords(settings.activeBooks).then((n) => {
      if (!cancelled) setRemainingNew(n);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.activeBooks.join(','), session.attemptCount, session.status]);

  // 仅学习/复习答题过程中展示；完成页已有今日情况卡片
  if (closed || session.status !== 'running' || (session.mode !== 'learn' && session.mode !== 'review')) return null;

  // 学习分母：今日可学总量 = min(配额, 词库剩余未学 + 今日已学)
  // 剩余未学是「当前时刻」尚未学的词，今天已学的词已不在其中，必须加回来，
  // 否则词库快学完时（剩余未学 < 今日已学）分母会小于分子（如已学 100、剩余 44 → 误显示 100/44 词）。
  // 词库全部学完（剩余未学 = 0）时退化为已学量（X/X 或 0/0）。
  const learnTotal =
    remainingNew !== null && remainingNew <= 0
      ? today?.newCount ?? 0
      : Math.max(1, Math.min(settings.dailyNewLimit, (remainingNew ?? settings.dailyNewLimit) + (today?.newCount ?? 0)));
  // 复习分母：今日实际到期量 = 已复习 + 待复习（复习推进时 reviewCount↑ dueCount↓，分母基本不变）
  const reviewTotal = Math.max(0, (today?.reviewCount ?? 0) + (today?.dueCount ?? 0));

  const learnPct = learnTotal > 0 ? Math.min(100, Math.round(((today?.newCount ?? 0) / learnTotal) * 100)) : 0;
  const reviewPct = reviewTotal > 0 ? Math.min(100, Math.round(((today?.reviewCount ?? 0) / reviewTotal) * 100)) : 0;

  return (
    <div
      className="fixed top-60 z-40 w-44 rounded-xl border-2 border-brand-300/80 bg-white/95 shadow-[0_6px_20px_-6px_rgba(30,41,59,0.35)] backdrop-blur dark:border-brand-800 dark:bg-slate-900/95 dark:shadow-none"
      // 外挂在居中单词卡（main max-w-3xl 内容区）右侧：
      // 单词卡右缘距视口右缘 = (100vw-48rem)/2 + 1rem(main px-4)；面板右缘距右 = 该值 - 面板宽(11rem) - 间距(0.75rem) = (100vw-48rem)/2 - 11.75rem
      // 小屏放不下时回退视口右缘
      style={{ right: 'max(0.75rem, calc((100vw - 48rem) / 2 - 11.75rem))' }}
    >
      {/* 标题栏（挂窗广告式） */}
      <div className="flex items-center justify-between bg-brand-soft-gradient px-2.5 py-2">
        <span className="text-xs font-bold text-brand-700 dark:text-brand-300">📌 今日进度</span>
        <button
          onClick={() => setClosed(true)}
          className="rounded px-1 text-xs leading-none text-brand-500 transition hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-200"
          aria-label="关闭今日进度悬浮窗"
        >
          ✕
        </button>
      </div>

      <div className="space-y-5 p-4">
        {/* 今日新学 */}
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>📖 新学</span>
            <span className="font-bold text-brand-600 dark:text-brand-400">{learnPct}%</span>
          </div>
          <div className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">
            {today?.newCount ?? 0}
            <span className="text-xs font-normal text-slate-400"> / {learnTotal} 词</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/60">
            <div className="progress-gradient h-full rounded-full transition-all duration-300" style={{ width: `${learnPct}%` }} />
          </div>
        </div>

        {/* 今日复习 */}
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>🔁 复习</span>
            <span className="font-bold text-sky-600 dark:text-sky-400">{reviewPct}%</span>
          </div>
          <div className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">
            {today?.reviewCount ?? 0}
            <span className="text-xs font-normal text-slate-400"> / {reviewTotal} 词</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/60">
            <div className="h-full rounded-full bg-sky-500/80 transition-all duration-300" style={{ width: `${reviewPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
