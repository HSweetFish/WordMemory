import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listWordsWithStatus,
  getInstalledBooks,
  isCustomWord,
  type WordWithStatus,
} from '@/services/wordbook';
import { speak } from '@/lib/tts';
import { friendlyDue } from '@/lib/format';
import { ui } from '@/lib/ui';
import { getLogsForWord } from '@/services/stats';
import { groupLogsByDay, RATING_META, ratingLabel, MODE_LABEL, timeHM, type DayGroup } from '@/lib/history';

/** 状态筛选选项（值对应 listWordsWithStatus 的 status 参数） */
const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '未学' },
  { value: 'learning', label: '新学中' },
  { value: 'consolidating', label: '巩固中' },
  { value: 'mastered', label: '已掌握' },
  { value: 'due', label: '待复习' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

const MASTERY_BADGE: Record<string, string> = {
  new: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  learning: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
  consolidating: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
  mastered: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
};

const MASTERY_LABEL: Record<string, string> = {
  new: '未学',
  learning: '新学中',
  consolidating: '巩固中',
  mastered: '已掌握',
};

/** 词表页：浏览词书 / 已学词回顾 / 全局搜索（三合一） */
export default function WordsPage() {
  const [books, setBooks] = useState<{ id: string; name: string; count: number }[]>([]);
  const [bookId, setBookId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<WordWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyByWord, setHistoryByWord] = useState<Record<string, DayGroup[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set());
  const debounceRef = useRef<number>(0);

  // 已安装词书（筛选用）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bs = await getInstalledBooks();
      if (!cancelled) setBooks(bs);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 防抖查询（搜索输入 300ms 防抖，其余筛选即时）
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      const items = await listWordsWithStatus({
        bookId: bookId || undefined,
        status,
        query: query || undefined,
        limit: 500,
      });
      setList(items);
      setLoading(false);
    }, query ? 300 : 0);
    return () => window.clearTimeout(debounceRef.current);
  }, [bookId, status, query]);

  const totalCount = useMemo(
    () => (bookId ? books.find((b) => b.id === bookId)?.count : undefined),
    [books, bookId],
  );

  const toggle = (w: string) => {
    const opening = !expanded.has(w);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });
    // 展开时懒加载该词记忆历史（只查一次）
    if (opening && !historyByWord[w]) {
      setHistoryLoading((prev) => new Set(prev).add(w));
      getLogsForWord(w)
        .then((logs) => {
          setHistoryByWord((prev) => ({ ...prev, [w]: groupLogsByDay(logs) }));
          setHistoryLoading((prev) => {
            const next = new Set(prev);
            next.delete(w);
            return next;
          });
        })
        .catch(() => {
          setHistoryLoading((prev) => {
            const next = new Set(prev);
            next.delete(w);
            return next;
          });
        });
    }
  };

  return (
    <div className="space-y-5">
      <h1 className={ui.h1}>🔍 词表</h1>

      {/* 搜索 + 筛选 */}
      <div className="space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索单词（如 apple）…"
          className={`${ui.input} w-full`}
          autoFocus
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            className={`${ui.input} flex-1 min-w-36`}
          >
            <option value="">全部词库</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}（{b.count}）
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className={`${ui.input} flex-1 min-w-28`}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 计数 */}
      {!loading && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          共 {list.length} 词{totalCount != null && !query ? ` / 词库共 ${totalCount} 词` : ''}
        </p>
      )}

      {/* 列表 */}
      {loading ? (
        <div className={ui.empty}>加载中…</div>
      ) : list.length === 0 ? (
        <div className={ui.empty}>
          {query || bookId || status !== 'all'
            ? '没有符合条件的单词，换个筛选试试'
            : '还没有任何单词，先去「词库」页安装词库'}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((item) => {
            const { word, userWord, mastery, due } = item;
            const isOpen = expanded.has(word.w);
            const phonetic = word.us || word.uk || '';
            return (
              <div key={word.w} className={ui.cardCompact}>
                <button
                  onClick={() => toggle(word.w)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-slate-800 dark:text-slate-100">
                        {word.w}
                      </span>
                      {word.pos && (
                        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                          {word.pos}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                      {word.m.slice(0, 2).join('；')}
                      {word.m.length > 2 ? ` 等 ${word.m.length} 条释义` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {due && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/50 dark:text-red-300">
                        待复习
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MASTERY_BADGE[mastery]}`}>
                      {MASTERY_LABEL[mastery]}
                    </span>
                    <span className={`text-slate-300 transition-transform dark:text-slate-600 ${isOpen ? 'rotate-180' : ''}`}>
                      ▾
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                    {/* 发音 + 音标 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => speak(word.w)}
                        className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-300"
                      >
                        🔊 发音
                      </button>
                      {word.us && <span className="text-sm text-slate-500 dark:text-slate-400">美 {word.us}</span>}
                      {word.uk && <span className="text-sm text-slate-500 dark:text-slate-400">英 {word.uk}</span>}
                      {phonetic === '' && <span className="text-xs text-slate-400 dark:text-slate-500">（无音标）</span>}
                    </div>

                    {/* 完整释义 */}
                    <div className="mt-3 space-y-1.5">
                      {word.m.map((m, i) => (
                        <div key={i} className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                          <span className="mr-1.5 text-brand-500">•</span>
                          {m}
                        </div>
                      ))}
                    </div>

                    {/* 例句 */}
                    {word.ex && word.ex.length > 0 && (
                      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm italic text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        {word.ex[0]}
                      </div>
                    )}

                    {/* 词频（自定义词书显示导入顺序号）+ 学习状态 */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
                      {word.freq != null && (
                        <span>{isCustomWord(word) ? `词序 #${word.freq}` : `COCA 词频 #${word.freq}`}</span>
                      )}
                      {userWord ? (
                        <>
                          <span>复习 {userWord.reps} 次</span>
                          <span>下次复习：{friendlyDue(userWord.due)}</span>
                          {userWord.stability != null && (
                            <span>记忆稳定性 {userWord.stability.toFixed(1)} 天</span>
                          )}
                        </>
                      ) : (
                        <span>尚未学习</span>
                      )}
                    </div>

                    {/* 记忆历史（按天时间线，展开时懒加载） */}
                    {userWord && (
                      <div className="mt-4">
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                          📜 记忆历史
                        </div>
                        {historyLoading.has(word.w) ? (
                          <div className="mt-2 text-xs text-slate-400">加载中…</div>
                        ) : historyByWord[word.w] && historyByWord[word.w].length > 0 ? (
                          <div className="mt-2 space-y-3">
                            {historyByWord[word.w].map((group) => (
                              <div key={group.date}>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                    {group.label}
                                  </span>
                                  {group.isLearningDay && (
                                    <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                                      新学
                                    </span>
                                  )}
                                  <span className="text-[10px] text-slate-300 dark:text-slate-600">
                                    {group.items.length} 次
                                  </span>
                                </div>
                                <div className="mt-1.5 space-y-1.5 border-l-2 border-slate-100 pl-3 dark:border-slate-800">
                                  {group.items.map((l, i) => {
                                    const meta = RATING_META[l.rating];
                                    return (
                                      <div key={i} className="flex items-center gap-2 text-xs">
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                                        <span className="text-slate-400 dark:text-slate-500">
                                          {timeHM(l.reviewedAt)}
                                        </span>
                                        <span
                                          className={`rounded-full px-2 py-0.5 font-medium ${meta.badge}`}
                                        >
                                          {meta.emoji} {ratingLabel(l.mode, l.rating)}
                                        </span>
                                        <span className="text-slate-400 dark:text-slate-500">
                                          {MODE_LABEL[l.mode]}
                                        </span>
                                        {l.scheduledDays > 0 && (
                                          <span className="text-slate-300 dark:text-slate-600">
                                            +{l.scheduledDays}天
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-slate-400">暂无答题记录</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
