import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession, type StudyMode, type PracticeMode } from '@/stores/session';
import { useSettings } from '@/stores/settings';
import type { Rating } from '@/types';
import { formatDuration } from '@/lib/format';
import { ui } from '@/lib/ui';
import { meaningLines } from '@/lib/meaning';
import WordCard from '@/components/study/WordCard';
import Quiz from '@/components/study/Quiz';
import Spell from '@/components/study/Spell';
import RatingBar from '@/components/study/RatingBar';

const PRACTICE_TABS: { value: PracticeMode; label: string; icon: string }[] = [
  { value: 'flip', label: '翻转', icon: '🃏' },
  { value: 'quiz', label: '四选一', icon: '🎯' },
  { value: 'spell', label: '拼写', icon: '⌨️' },
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

  // 首次挂载自动开始
  useEffect(() => {
    if (session.status === 'idle') {
      void session.start(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切题时重置题目状态
  useEffect(() => {
    setRevealed(false);
    setAnswered(false);
    setCorrect(false);
  }, [session.index, session.relearnIndex, session.practice]);

  // 学习模式：评分 1-2 未掌握 → 词会排到本组末尾再学一遍，给用户一句提示
  const handleRate = (r: Rating) => {
    if (r < 3) {
      setRecycleNotice(session.phase === 'relearn' ? '未掌握，稍后会再重学一次' : '未掌握，已排到本组末尾，稍后会再出现一次');
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setRecycleNotice(null), 2500);
    }
    void session.rate(r);
  };

  // 键盘快捷键：空格翻面 / 1-4 评分（回忆确认中禁用评分，回车/空格=记起来了）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (session.status !== 'running') return;
      if (session.phase === 'recall') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void session.confirmRecall(true);
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
    const rate = session.doneCount > 0 ? Math.min(100, Math.round((session.correctCount / session.doneCount) * 100)) : 0;
    return (
      <div className={`${ui.card} p-8 text-center`}>
        <div className="text-5xl">🎉</div>
        <h2 className="mt-3 text-xl font-bold text-slate-800 dark:text-slate-100">本轮完成</h2>
        {session.doneCount === 0 ? (
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            {mode === 'learn' ? '今日新词已学完或未到学习时间' : mode === 'random' ? '还没有已学单词，先去「学习」页学几个吧' : '暂无到期需要复习的单词'}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-brand-soft-gradient rounded-xl p-3">
              <div className="text-2xl font-bold text-brand-600">{session.doneCount}</div>
              <div className="text-xs text-slate-400">完成</div>
            </div>
            <div className="bg-brand-soft-gradient rounded-xl p-3">
              <div className="text-2xl font-bold text-emerald-600">{rate}%</div>
              <div className="text-xs text-slate-400">正确率</div>
            </div>
            <div className="bg-brand-soft-gradient rounded-xl p-3">
              <div className="text-2xl font-bold text-slate-600 dark:text-slate-200">{formatDuration(elapsed)}</div>
              <div className="text-xs text-slate-400">用时</div>
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => void session.start(mode)}
            className={ui.btnPrimaryLg}
          >
            {session.doneCount === 0 ? '再试一次' : session.hasMore && mode === 'learn' ? '继续下一组 ➜' : '再来一轮'}
          </button>
          <Link to="/" className={ui.btnSecondaryLg}>
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  // ---- 批量回忆确认（本轮全部学完后：出中文看能否想起来）----
  if (session.phase === 'recall') {
    const item = session.recallList[session.recallIndex];
    if (!item) return null;
    const { word, retries } = item;
    const lines = meaningLines(word);
    const retryCount = retries ?? 0;
    const progress = session.recallList.length > 0 ? ((session.recallIndex + 1) / session.recallList.length) * 100 : 0;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            💭 回忆确认
            <span className="ml-2 text-sm font-normal text-slate-400 dark:text-slate-500">
              {session.recallIndex + 1} / {session.recallList.length}
            </span>
          </h1>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div className="progress-gradient h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        <div className="bg-brand-soft-gradient rounded-2xl border border-brand-100 p-8 text-center shadow-sm dark:border-brand-900/50 dark:bg-slate-900">
          <div className="text-xs text-slate-400 dark:text-slate-500">💭 看到中文，能想起来这个单词吗？</div>
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
            <button
              onClick={() => void session.confirmRecall(false)}
              className={`${ui.btnSecondaryLg} border-red-200 text-red-500 hover:border-red-300 hover:text-red-600 dark:border-red-900/50 dark:text-red-400`}
            >
              🤔 没想起来
            </button>
            <button onClick={() => void session.confirmRecall(true)} className={ui.btnPrimaryLg}>
              💡 记起来了
            </button>
          </div>
        </div>

        <div className="text-center text-xs text-slate-400">
          记起来 → 进入复习阶段 · 没想起来 → 清空数据重新学一遍（回车可直接确认记起来了）
        </div>
      </div>
    );
  }

  // ---- 运行中（学习 / 复习 / 抽查 / 重学）----
  const isRelearn = session.phase === 'relearn';
  const item = isRelearn ? session.relearnQueue[session.relearnIndex] : session.queue[session.index];
  if (!item) return null;
  const { word } = item;
  // 学习/重学进度按「已掌握数 / 初始队列数」计算（回炉追加的词不计入分母）；
  // 复习/抽查按当前位置 / 队列长度
  const total = isRelearn ? session.relearnQueue.length : session.mode === 'learn' ? session.initialTotal : session.queue.length;
  const current = isRelearn ? session.relearnIndex + 1 : session.mode === 'learn' ? session.doneCount : session.index + 1;
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
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="progress-gradient h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
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
          <>
            {recycleNotice && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-600">
                ↩️ {recycleNotice}
              </div>
            )}
            <RatingBar onRate={handleRate} correct={session.practice === 'flip' ? null : correct} mode={mode === 'learn' ? 'learn' : 'review'} />
          </>
        )}
      </div>

      <div className="text-center text-xs text-slate-400">
        空格：翻面 · 数字键 1-4：评分
        {isRelearn
          ? ' · 1-2 再学一遍，3-4 完成重学'
          : mode === 'learn'
            ? ' · 1-2 会再学一遍，3-4 掌握，本轮结束后统一回忆确认'
            : mode === 'random'
              ? ' · 抽查不占用今日复习配额'
              : ''}
      </div>
    </div>
  );
}
