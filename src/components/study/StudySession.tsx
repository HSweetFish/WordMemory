import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession, type StudyMode, type PracticeMode } from '@/stores/session';
import { useSettings } from '@/stores/settings';
import type { Rating } from '@/types';
import { formatDuration } from '@/lib/format';
import { ui } from '@/lib/ui';
import { speak, stopSpeak } from '@/lib/tts';
import { meaningLines } from '@/lib/meaning';
import WordCard from '@/components/study/WordCard';
import Quiz from '@/components/study/Quiz';
import Spell from '@/components/study/Spell';
import RatingBar from '@/components/study/RatingBar';
import { ratingLabel } from '@/lib/history';
import { getTodaySummary, type TodaySummary } from '@/services/stats';
import { countNewWords } from '@/services/wordbook';

const PRACTICE_TABS: { value: PracticeMode; label: string }[] = [
  { value: 'flip', label: '翻转' },
  { value: 'quiz', label: '四选一' },
  { value: 'spell', label: '拼写' },
];

interface StudySessionProps {
  mode: StudyMode;
}

/** 学习/复习会话：队列推进 + 练习模式 + 评分（含键盘快捷键） */
export default function StudySession({ mode }: StudySessionProps) {
  const session = useSession();
  const { settings } = useSettings();
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [correct, setCorrect] = useState(false);
  // 学习模式重学提示：评分 1-2 未掌握 → 词排到队尾再学一遍，短暂提示用户
  const [recycleNotice, setRecycleNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number>(0);
  // 完成页空态（无任务）时展示的今日概况：今日新学/复习/正确率/待复习/打卡
  const [today, setToday] = useState<TodaySummary | null>(null);
  // 词库剩余未学词数（学习页「今日新学进度」分母：min(配额, 实际未学)，避免按硬编码配额虚算）
  const [remainingNew, setRemainingNew] = useState<number | null>(null);

  // 词库剩余未学词数（与首页口径一致：countNewWords）
  // 每次作答后刷新：学习会消耗剩余未学，若只在挂载时取一次（快照），
  // 学到中途剩余数不会下降，与今日已学相加会虚高（如已学 140、剩余快照 44 → 分母 184）
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
  }, [settings.activeBooks.join(','), session.attemptCount, session.status]);

  // 学习页「今日新学」分母：今日可学总量 = min(配额, 词库剩余未学 + 今日已学)；
  // 剩余未学是当前时刻值，今天已学部分已不在其中必须加回，否则词库快学完时
  // 分母会小于分子（如已学 100、剩余 44 → 误显示 100/44 词）；
  // 词库全部学完(剩余 0)时退化为今天已学量——今天没学则为 0，主卡显示 0/0
  const learnTotal = today
    ? remainingNew !== null && remainingNew <= 0
      ? today.newCount
      : Math.max(1, Math.min(settings.dailyNewLimit, (remainingNew ?? settings.dailyNewLimit) + today.newCount))
    : 0;
  // 复习页「今日复习」分母：实际到期量 = 已复习 + 待复习（今天无到期时为 0，主卡显示 0/0）
  const reviewTotal = today ? today.reviewCount + today.dueCount : 0;

  // 完成页空态时加载今日概况（无任务 = 今日学习/复习已做完，展示今日成果而非空白提示）
  useEffect(() => {
    if (session.status === 'finished' && session.doneCount === 0) {
      let cancelled = false;
      void getTodaySummary().then((s) => {
        if (!cancelled) setToday(s);
      });
      return () => {
        cancelled = true;
      };
    }
    setToday(null);
  }, [session.status, session.doneCount]);

  // 首次挂载自动开始。
  // 必须用 useSession.getState() 读最新状态，而非渲染闭包 session.status：
  // 学习页 → 复习页直接切换时，本组件首帧渲染读到的是旧会话残留的 running，
  // 若按闭包快照判断会误判「已在运行」而不启动；旧页 cleanup 的 reset() 在 paint
  // 后的 passive unmount 阶段才执行，getState() 才能拿到 reset 后的 idle。
  useEffect(() => {
    const s = useSession.getState();
    if (s.status === 'idle') {
      void s.start(mode);
    }
  }, [mode]);

  // 回忆确认：翻面显示英文时跟随「自动朗读」设置发音（与新学卡片一致）；
  // 每次进入下一词 / 翻面都会触发（依赖 recallIndex 与 recallRevealed）
  useEffect(() => {
    if (session.phase !== 'recall' || !session.recallRevealed) return;
    const item = session.recallList[session.recallIndex];
    if (!item || !settings.autoSpeak) return;
    speak(item.word.w);
    return () => stopSpeak();
  }, [session.phase, session.recallRevealed, session.recallIndex, session.recallList, settings.autoSpeak]);

  // 切题时重置题目状态。
  // 必须用 useLayoutEffect（渲染后、绘制前同步执行）：若用 useEffect，
  // 切到下一题时 revealed 还带着上一题的 true，新卡片会先以背面（中文释义）渲染一帧，
  // 造成「翻页动画 + 提前看到下一个词的中文意思」的泄题问题。
  useLayoutEffect(() => {
    setRevealed(false);
    setAnswered(false);
    setCorrect(false);
  }, [session.index, session.relearnIndex, session.practice]);

  // 学习/复习：评分 1-2 未掌握/没记住 → 词会排到本组末尾再考一遍，给用户一句提示
  const handleRate = (r: Rating) => {
    if (r < 3) {
      const isReview = session.mode === 'review' && session.phase !== 'relearn';
      setRecycleNotice(
        isReview
          ? '没记住，稍后会再考一次'
          : session.phase === 'relearn'
            ? '未掌握，稍后会再重学一次'
            : '未掌握，已排到本组末尾，稍后会再出现一次',
      );
      window.clearTimeout(noticeTimer.current);
      // 短提示即可（1.2s）：评完分下一张卡马上出现，提示太长会滞留到下一张卡
      noticeTimer.current = window.setTimeout(() => setRecycleNotice(null), 1200);
    }
    void session.rate(r);
  };

  // 键盘快捷键：空格翻面 / 1-4 评分（回忆确认中禁用评分；回车/空格：未翻面→翻面看英文，已翻面→确实记住了）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (session.status !== 'running') return;
      if (session.phase === 'recall') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (session.recallRevealed) void session.confirmRecall(true);
          else session.revealRecall();
        }
        return;
      }
      if (e.code === 'Space' && session.practice === 'flip' && !revealed) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (['1', '2', '3', '4'].includes(e.key)) {
        const canRate = session.practice === 'flip' ? revealed : answered;
        if (canRate) handleRate(Number(e.key) as Rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session.status, session.practice, revealed, answered, session.phase, session]);

  // ---- 加载中 ----
  if (session.status === 'loading') {
    return <div className="py-20 text-center text-slate-400">正在准备学习队列…</div>;
  }

  // ---- 未选词库 ----
  if (session.status !== 'running' && session.status !== 'finished' && settings.activeBooks.length === 0) {
    return (
      <div className={ui.empty}>
        <div className="text-4xl">📚</div>
        <p className="mt-3 text-slate-600 dark:text-slate-300">还没有选择词库</p>
        <p className="mt-1 text-sm text-slate-400">先去「词库」页选择要背的词库</p>
        <Link to="/books" className={`mt-4 inline-block ${ui.btnPrimaryLg}`}>
          去选词库
        </Link>
      </div>
    );
  }

  // ---- 完成页 ----
  if (session.status === 'finished') {
    const elapsed = (Date.now() - session.sessionStartedAt) / 1000;
    const rate = session.attemptCount > 0 ? Math.round((session.correctCount / session.attemptCount) * 100) : 0;
    return (
      <div className={`${ui.card} p-8`}>
        {/* 顶部：标题 + 操作按钮（返回首页 / 继续下一组），无需滑到底部 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-4xl">🎉</div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">本轮完成</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => void session.start(mode)}
              className={ui.btnPrimary}
            >
              {session.doneCount === 0 ? '再试一次' : session.hasMore ? '继续下一组 ➜' : '再来一轮'}
            </button>
            <Link to="/" className={ui.btnSecondary}>
              返回首页
            </Link>
          </div>
        </div>

        {session.doneCount === 0 ? (
          // 无任务：学习/复习页分别展示「今日学习/复习情况」（抽查页保留简单提示）
          mode === 'random' ? (
            <p className="mt-4 text-center text-slate-500 dark:text-slate-400">
              还没有已学单词，先去「学习」页学几个吧
            </p>
          ) : mode === 'learn' ? (
            <div className="mt-5">
              <div className="mb-3 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                今日学习情况
              </div>
              {!today ? (
                <div className="py-4 text-center text-sm text-slate-400">统计中…</div>
              ) : (
                <>
                  {/* 主角：今日新学进度（已学 / 实际可学量 = min(配额, 词库剩余未学)） */}
                  <div className="rounded-xl bg-brand-soft-gradient p-3 text-center">
                    <div className="text-2xl font-bold text-brand-600">
                      {today.newCount}
                      <span className="text-sm font-normal text-slate-400"> / {learnTotal} 词</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">今日新学进度</div>
                    <div className="mx-auto mt-2 h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/60">
                      <div
                        className="progress-gradient h-full rounded-full"
                        style={{ width: `${learnTotal > 0 ? Math.min(100, (today.newCount / learnTotal) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  {/* 辅助：正确率 / 连续打卡 / 今日答题（学习页只看自己的指标，不放复习） */}
                  <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                      <div className="text-xl font-bold text-emerald-600">
                        {today.totalCount > 0 ? Math.round((today.correctCount / today.totalCount) * 100) : 0}%
                      </div>
                      <div className="text-xs text-slate-400">今日正确率</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                      <div className="text-xl font-bold text-amber-600">{today.streak}</div>
                      <div className="text-xs text-slate-400">连续打卡</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                      <div className="text-xl font-bold text-slate-600 dark:text-slate-200">{today.totalCount}</div>
                      <div className="text-xs text-slate-400">今日答题</div>
                    </div>
                  </div>
                  {/* 引导：还有到期复习词时去复习页 */}
                  {today.dueCount > 0 && (
                    <Link
                      to="/review"
                      className="mt-3 block rounded-xl border border-slate-200 bg-white/60 px-4 py-2.5 text-center text-sm font-medium text-slate-600 transition-colors hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:text-sky-400"
                    >
                      还有 {today.dueCount} 个单词待复习 →
                    </Link>
                  )}
                </>
              )}
              <p className="mt-3 text-center text-slate-500 dark:text-slate-400">
                今日新词已学完（或今日配额已用完），明天再来吧
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <div className="mb-3 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                今日复习情况
              </div>
              {!today ? (
                <div className="py-4 text-center text-sm text-slate-400">统计中…</div>
              ) : (
                <>
                  {/* 主角：今日复习进度（已复习 / 实际到期量 = 已复习 + 待复习） */}
                  <div className="rounded-xl bg-brand-soft-gradient p-3 text-center">
                    <div className="text-2xl font-bold text-sky-600">
                      {today.reviewCount}
                      <span className="text-sm font-normal text-slate-400"> / {reviewTotal} 词</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">今日复习进度</div>
                    <div className="mx-auto mt-2 h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/60">
                      <div
                        className="h-full rounded-full bg-sky-500/80"
                        style={{ width: `${reviewTotal > 0 ? Math.min(100, (today.reviewCount / reviewTotal) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  {/* 辅助：正确率 / 连续打卡 / 预计明天复习数（复习页只看自己的指标，不放新学） */}
                  <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                      <div className="text-xl font-bold text-emerald-600">
                        {today.totalCount > 0 ? Math.round((today.correctCount / today.totalCount) * 100) : 0}%
                      </div>
                      <div className="text-xs text-slate-400">今日正确率</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                      <div className="text-xl font-bold text-amber-600">{today.streak}</div>
                      <div className="text-xs text-slate-400">连续打卡</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                      <div className="text-xl font-bold text-slate-600 dark:text-slate-200">{today.dueTomorrow}</div>
                      <div className="text-xs text-slate-400">预计明天复习</div>
                    </div>
                  </div>
                </>
              )}
              <p className="mt-3 text-center text-slate-500 dark:text-slate-400">
                {today && reviewTotal > 0
                  ? today.dueCount === 0
                    ? '今日到期词已全部复习 ✓'
                    : '今日复习配额已用完，明天继续吧'
                  : '今日无到期复习任务，明天再来吧'}
              </p>
            </div>
          )
        ) : (
          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <div className="bg-brand-soft-gradient rounded-xl p-3">
              <div className="text-2xl font-bold text-brand-600">{session.doneCount}</div>
              <div className="text-xs text-slate-400">完成</div>
            </div>
            <div className="bg-brand-soft-gradient rounded-xl p-3">
              <div className="text-2xl font-bold text-emerald-600">{rate}%</div>
              <div className="text-xs text-slate-400">正确率 · 答对 {session.correctCount}/{session.attemptCount}</div>
            </div>
            <div className="bg-brand-soft-gradient rounded-xl p-3">
              <div className="text-2xl font-bold text-slate-600 dark:text-slate-200">{formatDuration(elapsed)}</div>
              <div className="text-xs text-slate-400">用时</div>
            </div>
          </div>
        )}

        {/* 本轮完成的单词列表（按词去重；复习/抽查/新学完成页通用） */}
        {session.doneWords.length > 0 && (
          <div className="mt-5 text-left">
            <div className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
              {mode === 'review' ? '本次复习单词' : mode === 'random' ? '本轮抽查单词' : '本轮新学单词'}（{session.doneWords.length}）
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60">
              {session.doneWords.map((d, i) => {
                const lines = meaningLines(d.word);
                // 完成页评分标签与评分按钮 / 记忆历史保持一致（新学 vs 复习/抽查）
                const label = ratingLabel(mode, d.rating);
                const ratingColor =
                  d.rating === 1
                    ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400'
                    : d.rating === 2
                      ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                      : d.rating === 4
                        ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400'
                        : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400';
                return (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2 shadow-sm dark:bg-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{d.word.w}</div>
                      <div className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {lines.map((g) => `${g.pos} ${g.meaning}`).join('；')}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${ratingColor}`}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- 批量回忆确认（两步式：先出中文回忆 → 翻面看英文 → 再选确实记住了/记错了；重学通过后会再次进入此阶段二次确认）----
  if (session.phase === 'recall') {
    const item = session.recallList[session.recallIndex];
    if (!item) return null;
    const { word, retries } = item;
    const lines = meaningLines(word);
    const retryCount = retries ?? 0;
    const isReconfirm = retryCount > 0;
    const revealed = session.recallRevealed;
    const progress = session.recallList.length > 0 ? ((session.recallIndex + 1) / session.recallList.length) * 100 : 0;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {isReconfirm ? '🔄 再次确认' : '💭 回忆确认'}
            <span className="ml-2 text-sm font-normal text-slate-400 dark:text-slate-500">
              {session.recallIndex + 1} / {session.recallList.length}
            </span>
          </h1>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div className="progress-gradient h-full rounded-full transition-all duration-[250ms]" style={{ width: `${progress}%` }} />
        </div>

        <div className="bg-brand-soft-gradient rounded-2xl border border-brand-100 p-8 text-center shadow-sm dark:border-brand-900/50 dark:bg-slate-900">
          {!revealed ? (
          <>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {isReconfirm ? '🔄 重学过了，再看中文能想起来吗？' : '💭 看到中文，能想起来是哪个单词吗？'}
          </div>
              <div className="mt-4 space-y-1.5">
                {lines.map((g, i) => (
                  <div key={i} className="text-xl font-semibold leading-relaxed text-slate-800 dark:text-slate-100">
                    <span className="text-base font-bold text-brand-600 dark:text-brand-400">{g.pos}</span>
                    <span className="ml-2">{g.meaning}</span>
                  </div>
                ))}
              </div>
              {retryCount > 0 && (
                <div className="mt-3 text-xs font-medium text-amber-600">已重新学习 {retryCount} 次，这次努力回忆一下</div>
              )}

              <div className="mt-8 flex justify-center gap-3">
                <button onClick={() => void session.revealRecall()} className={ui.btnPrimaryLg}>
                  👀 确认，显示英文
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-slate-400 dark:text-slate-500">👀 是这个词吗？真的记住了吗？</div>
              <div className="mt-4 flex items-center justify-center gap-3">
                <div className="text-4xl font-extrabold tracking-wide text-slate-900 dark:text-white">{word.w}</div>
                <button
                  className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-600 transition hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300 dark:hover:bg-brand-900/70"
                  onClick={() => speak(word.w)}
                  title="发音"
                >
                  🔊 发音
                </button>
              </div>
              {word.uk && <div className="mt-1 text-sm text-slate-400">英 [{word.uk}]</div>}
              <div className="mt-4 space-y-1.5">
                {lines.map((g, i) => (
                  <div key={i} className="text-base leading-relaxed text-slate-500 dark:text-slate-400">
                    <span className="font-bold text-brand-600 dark:text-brand-400">{g.pos}</span>
                    <span className="ml-2">{g.meaning}</span>
                  </div>
                ))}
              </div>
              {retryCount > 0 && (
                <div className="mt-3 text-xs font-medium text-amber-600">已重新学习 {retryCount} 次，这次努力回忆一下</div>
              )}

              <div className="mt-8 flex justify-center gap-3">
                <button
                  onClick={() => void session.confirmRecall(false)}
                  className={`${ui.btnSecondaryLg} border-red-200 text-red-500 hover:border-red-300 hover:text-red-600 dark:border-red-900/50 dark:text-red-400`}
                >
                  😅 记错了
                </button>
                <button onClick={() => void session.confirmRecall(true)} className={ui.btnPrimaryLg}>
                  ✅ 确实记住了
                </button>
              </div>
            </>
          )}
        </div>

        <div className="text-center text-xs text-slate-400">
          {revealed
            ? '确实记住了 → 进入下一步 · 记错了 → 重新学一遍，通过后还会再确认一次（回车 = 确实记住了）'
            : '先回忆，再点「确认」显示英文对照（回车/空格 = 确认）'}
        </div>
      </div>
    );
  }

  // ---- 运行中（学习 / 复习 / 抽查 / 重学）----
  const isRelearn = session.phase === 'relearn';
  const item = isRelearn ? session.relearnQueue[session.relearnIndex] : session.queue[session.index];
  if (!item) return null;
  const { word } = item;
  // 学习/复习进度按「已掌握数 / 本组初始队列数」计算（回炉追加的词不计入分母，进度不虚涨、不回退）；
  // 抽查按当前位置 / 队列长度
  const total = isRelearn ? session.relearnQueue.length : session.mode === 'random' ? session.queue.length : session.initialTotal;
  const current = isRelearn ? session.relearnIndex + 1 : session.mode === 'random' ? session.index + 1 : session.doneCount;
  const progress = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* 顶部：模式 + 进度 */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {isRelearn ? '🔁 重学中' : mode === 'learn' ? '📖 今日新学' : mode === 'random' ? '🎲 随机抽查' : '🔁 今日复习'}
          <span className="ml-2 text-sm font-normal text-slate-400 dark:text-slate-500">
            {current} / {total}
          </span>
        </h1>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
          {PRACTICE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => session.setPractice(tab.value)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                session.practice === tab.value
                  ? 'bg-white font-medium text-brand-600 shadow-sm dark:bg-slate-700 dark:text-brand-300'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="progress-gradient h-full rounded-full transition-all duration-[250ms]" style={{ width: `${progress}%` }} />
      </div>

      {/* 题目区（按练习模式渲染，key 强制重置内部状态） */}
      <div key={`${isRelearn ? 'r' : 's'}-${isRelearn ? session.relearnIndex : session.index}-${session.practice}`}>
        {session.practice === 'flip' && (
          <WordCard word={word} revealed={revealed} onReveal={() => setRevealed(true)} autoSpeak={settings.autoSpeak} />
        )}
        {session.practice === 'quiz' && (
          <Quiz
            word={word}
            onAnswered={(ok) => {
              setAnswered(true);
              setCorrect(ok);
            }}
          />
        )}
        {session.practice === 'spell' && (
          <Spell
            word={word}
            onAnswered={(ok) => {
              setAnswered(true);
              setCorrect(ok);
            }}
          />
        )}

        {/* 评分栏：翻转模式翻面后 / 答题模式答完后 */}
        {(session.practice === 'flip' ? revealed : answered) && (
          <RatingBar onRate={handleRate} correct={session.practice === 'flip' ? null : correct} mode={mode === 'learn' ? 'learn' : 'review'} />
        )}
      </div>

      {/* 回炉提示：评分 1-2 后立即显示。放在题目区外、不依赖翻面/答题状态——
          否则切到下一张卡时新卡 revealed=false 会把提示藏起来，要等翻面下一张才出现（延迟反馈） */}
      {recycleNotice && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-600">
          ↩️ {recycleNotice}
        </div>
      )}

      <div className="text-center text-xs text-slate-400">
        空格：翻面 · 数字键 1-4：评分
        {isRelearn
          ? ' · 1-2 再学一遍，3-4 通过后还会再回忆确认一次'
          : mode === 'learn'
            ? ' · 1-2 会再学一遍，3-4 掌握，本轮结束后统一回忆确认'
            : mode === 'random'
              ? ' · 抽查不占用今日复习配额'
              : ' · 1-2 没记住会再考一遍，3-4 通过'}
      </div>
    </div>
  );
}
