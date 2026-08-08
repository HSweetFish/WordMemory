import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookMeta } from '@/types';
import {
  fetchManifest,
  installBook,
  uninstallBook,
  isBookInstalled,
  parseCustomJson,
  parseCustomCsv,
  importCustomWords,
  getCustomBooks,
  type CustomBookInfo,
  countInstalledWords,
} from '@/services/wordbook';
import { useSettings } from '@/stores/settings';
import { ui } from '@/lib/ui';

interface BookState extends BookMeta {
  installed: boolean;
  installing: boolean;
  progress: number;
}

/** 词库页：内置词库安装/卸载 + 自定义词表导入（步骤 9） */
export default function BooksPage() {
  const { settings, set } = useSettings();
  const [books, setBooks] = useState<BookState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [totalWords, setTotalWords] = useState(0);
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [customBooks, setCustomBooks] = useState<CustomBookInfo[]>([]);
  const [bookName, setBookName] = useState('');

  const refresh = useCallback(async () => {
    try {
      const manifest = await fetchManifest();
      const states = await Promise.all(
        manifest.map(async (b) => ({ ...b, installed: await isBookInstalled(b.id), installing: false, progress: 0 })),
      );
      setBooks(states);
      setTotalWords(await countInstalledWords());
      setCustomBooks(await getCustomBooks());
    } catch (e) {
      setMsg({ ok: false, text: `词库清单加载失败：${e instanceof Error ? e.message : '未知错误'}` });
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    window.setTimeout(() => setMsg(null), 5000);
  };

  const onInstall = async (id: string) => {
    setBusyId(id);
    setBooks((bs) => bs.map((b) => (b.id === id ? { ...b, installing: true, progress: 0 } : b)));
    try {
      await installBook(id, (done, total) => {
        setBooks((bs) => bs.map((b) => (b.id === id ? { ...b, progress: Math.round((done / total) * 100) } : b)));
      });
      await refresh();
      // 安装后自动加入学习词库（若之前为空）
      set({ activeBooks: settings.activeBooks.includes(id) ? settings.activeBooks : [...settings.activeBooks, id] });
      flash(true, `✅ 词库已安装`);
    } catch (e) {
      flash(false, `安装失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusyId('');
      setBooks((bs) => bs.map((b) => (b.id === id ? { ...b, installing: false } : b)));
    }
  };

  const onUninstall = async (id: string) => {
    if (!window.confirm('卸载该词库？已学习的单词记录会保留，但不再出现在新词队列。')) return;
    setBusyId(id);
    try {
      await uninstallBook(id);
      set({ activeBooks: settings.activeBooks.filter((b) => b !== id) });
      await refresh();
      flash(true, '🗑️ 词库已卸载');
    } catch (e) {
      flash(false, `卸载失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusyId('');
    }
  };

  const onImportFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();
      const words = name.endsWith('.csv') || name.endsWith('.txt') ? parseCustomCsv(text) : parseCustomJson(text);
      if (words.length === 0) throw new Error('没有解析到有效词条');
      // 目标词库：输入了名称 → custom:名称（同名追加，异名新建）；留空 → 默认我的词库
      const target = bookName.trim() ? `custom:${bookName.trim()}` : 'custom';
      const n = await importCustomWords(words, target, (done, total) => {
        setMsg({ ok: true, text: `导入中… ${done}/${total}` });
      });
      await refresh();
      // 自定义词自动加入学习词库
      if (!settings.activeBooks.includes(target)) {
        set({ activeBooks: [...settings.activeBooks, target] });
      }
      setBookName('');
      flash(true, `✅ 已导入 ${n} 个单词到「${target === 'custom' ? '我的词库' : bookName.trim()}」（含原有词条更新）`);
    } catch (e) {
      flash(false, `导入失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const activeCount = settings.activeBooks.length;

  return (
    <div className="space-y-5">
      <h1 className={ui.h1}>📚 词库</h1>

      {msg && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            msg.ok
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      <section className={ui.card}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={ui.sectionTitle}>内置词库</h2>
            <p className={ui.sectionDesc}>
              已装词条 {totalWords} 个 · 学习中词库 {activeCount} 个
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {!loaded && <p className="py-6 text-center text-sm text-slate-400">加载词库清单…</p>}
          {books.map((b) => (
            <div key={b.id} className={`flex items-center justify-between gap-3 ${ui.row}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{b.name}</span>
                  {settings.activeBooks.includes(b.id) && (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900 dark:text-brand-300">
                      学习中
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">{b.desc}</p>
                <div className="mt-1 text-xs text-slate-400">约 {b.count} 词</div>
                {b.installing && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="progress-gradient h-full rounded-full transition-all" style={{ width: `${b.progress}%` }} />
                  </div>
                )}
              </div>
              <button
                onClick={() => (b.installed ? void onUninstall(b.id) : void onInstall(b.id))}
                disabled={busyId === b.id}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${
                  b.installed
                    ? 'border border-slate-200 text-slate-600 hover:border-red-300 hover:text-red-500 dark:border-slate-700 dark:text-slate-300'
                    : 'btn-gradient'
                }`}
              >
                {busyId === b.id ? (b.installing ? `${b.progress}%` : '处理中…') : b.installed ? '卸载' : '安装'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={ui.card}>
        <h2 className={ui.sectionTitle}>📥 自定义导入</h2>
        <p className={ui.sectionDesc}>
          支持 JSON（qwerty-learner 格式）与 CSV（表头 name,trans,usphone,ukphone,sentence,pos,freq），详见 docs/IMPORT_FORMAT.md
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={bookName}
            onChange={(e) => setBookName(e.target.value)}
            placeholder="词库名称（留空为「我的词库」）"
            className={`${ui.input} w-56`}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className={ui.btnPrimary}
          >
            {importing ? '导入中…' : '📄 选择文件导入'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.txt,application/json,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">同名导入会追加到同一词库（重复词更新释义）；不同名称 = 新建独立词库</p>
      </section>

      <section className={ui.card}>
        <h2 className={ui.sectionTitle}>📖 自定义词库</h2>
        <p className={ui.sectionDesc}>自定义导入的词库，可多本独立管理、分别启用</p>
        {customBooks.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">还没有自定义词库，导入第一个文件即自动创建</p>
        ) : (
          <div className="mt-3 space-y-2">
            {customBooks.map((b) => (
              <div key={b.id} className={`flex items-center justify-between gap-3 ${ui.row}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{b.name}</span>
                    {settings.activeBooks.includes(b.id) && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900 dark:text-brand-300">
                        学习中
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{b.count} 词</p>
                </div>
                <button
                  onClick={() => void onUninstall(b.id)}
                  disabled={busyId === b.id}
                  className="shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:border-red-300 hover:text-red-500 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                >
                  {busyId === b.id ? '处理中…' : '删除'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
