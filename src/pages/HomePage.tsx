import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDueCount, getTodayNewCount, computeStreak } from '@/services/stats';
import { countNewWords, getInstalledBooks } from '@/services/wordbook';
import { useSettings } from '@/stores/settings';
import { ui } from '@/lib/ui';

interface HomeStats {
  due: number;
  todayNew: number;
  newLimit: number;
  streak: number;
}

/** 首页：今日新学 / 待复习双入口 + 连续打卡 */
export default function HomePage() {
  const { settings } = useSettings();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [remainingNew, setRemainingNew] = useState<number | null>(null);
  // 正在学的第一本词书名（显示在「今日新学」卡片上）
  const [firstBookName, setFirstBookName] = useState<string | null>(null);

  // 词库剩余未学词数（与每日配额取较小值显示）
  useEffect(() => {
    if (settings.activeBooks.length === 0) {
      setRemainingNew(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const n = await countNewWords(settings.activeBooks);
      if (!cancelled) setRemainingNew(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.activeBooks.join(',')]);

  // 取正在学的第一本词书名（settings.activeBooks[0] 对应已安装词库）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (settings.activeBooks.length === 0) {
        setFirstBookName(null);
        return;
      }
      const books = await getInstalledBooks();
      const first = books.find((b) => b.id === settings.activeBooks[0]);
      if (!cancelled) setFirstBookName(first?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.activeBooks.join(',')]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [due, todayNew, streak] = await Promise.all([getDueCount(), getTodayNewCount(), computeStreak()]);
      if (!cancelled) setStats({ due, todayNew, newLimit: settings.dailyNewLimit, streak });
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.dailyNewLimit]);

  // 从学习/复习页返回时刷新
  useEffect(() => {
    const t = setInterval(async () => {
      const [due, todayNew, streak] = await Promise.all([getDueCount(), getTodayNewCount(), computeStreak()]);
      setStats({ due, todayNew, newLimit: settings.dailyNewLimit, streak });
    }, 15000);
    return () => clearInterval(t);
  }, [settings.dailyNewLimit]);

  // 今日新学剩余 = min(每日配额剩余, 词库未学词数)；
  // 两者取小：配额设 100 但词库只剩 17 个未学词时显示 17，而不是 100
  const newRemaining =
    stats && remainingNew !== null ? Math.max(0, Math.min(stats.newLimit - stats.todayNew, remainingNew)) : 0;

  return (
    <div className="space-y-6">
      <section className="bg-hero-gradient relative overflow-hidden rounded-2xl p-6 text-white shadow-lg">
        {/* 装饰光晕 */}
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/10 blur-xl" />
        <div className="relative flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">欢迎回来 👋</h1>
            <p className="mt-1 text-sm text-brand-100">新词和复习都由遗忘曲线排好，到点打开就能学。</p>
          </div>
          {stats && stats.streak > 0 && (
            <div className="bg-accent-gradient rounded-xl px-3 py-2 text-center text-white">
              <div className="text-2xl font-bold">{stats.streak}</div>
              <div className="text-[10px] text-orange-100">连续打卡</div>
            </div>
          )}
        </div>

        <div className="relative mt-4 grid grid-cols-3 gap-3 lg:grid-cols-12">
          <Link
            to="/learn"
            className="card-hover col-span-1 rounded-xl bg-white/15 p-4 backdrop-blur hover:bg-white/25 lg:col-span-5"
          >
            <div className="text-3xl">📖</div>
            <div className="mt-1 font-semibold">今日新学</div>
            {settings.activeBooks.length === 0 ? (
              <div className="text-xs text-brand-100">请先选择词库</div>
            ) : (
              <>
                <div className="mt-1 text-2xl font-bold text-white">{newRemaining}</div>
                <div className="text-xs text-brand-100">个新词待学</div>
                {firstBookName && (
                  <div className="mt-1 max-w-full truncate rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] text-brand-50">
                    📚 {firstBookName}
                  </div>
                )}
              </>
            )}
          </Link>
          <Link
            to="/review"
            className="card-hover col-span-1 rounded-xl bg-white/15 p-4 backdrop-blur hover:bg-white/25 lg:col-span-4"
          >
            <div className="text-3xl">🔁</div>
            <div className="mt-1 font-semibold">待复习</div>
            <div className="mt-1 text-2xl font-bold text-white">{stats ? stats.due : '…'}</div>
            <div className="text-xs text-brand-100">个单词到期</div>
          </Link>
          <Link
            to="/random"
            className="card-hover col-span-1 rounded-xl bg-white/15 p-3 backdrop-blur hover:bg-white/25 lg:col-span-3"
          >
            <div className="text-2xl">🎲</div>
            <div className="mt-1 text-sm font-semibold">随机抽查</div>
            <div className="mt-0.5 text-[11px] leading-tight text-brand-100">检验长期记忆</div>
          </Link>
        </div>
      </section>

      {settings.activeBooks.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠️ 尚未选择词库，去「词库」页选择要背的词库（四级 / 六级 / 考研 / 雅思 / 托福…）
        </div>
      )}

      <section className={ui.card}>
        <h2 className={ui.sectionSub}>使用指南</h2>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li>在「词库」页选择要背的词库（四级 / 六级 / 考研 / 雅思 / 托福…）</li>
          <li>每天在「学习」页学新词：翻转卡片 → 自测 → 拼写，掌握后自动进入遗忘曲线</li>
          <li>「复习」页按 FSRS 遗忘曲线自动排程，到期即复习，答错立即回炉</li>
          <li>「统计」页查看打卡热力图、学习趋势与掌握度分布</li>
          <li>「设置」页填入 AI API Key，获得周期报告与单词助记</li>
        </ol>
      </section>
    </div>
  );
}
