import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { mdToHtml } from '@/lib/markdown';
import { hasAiKey } from '@/services/ai';

interface AiResultProps {
  /** 异步生成内容 */
  generate: () => Promise<string>;
  /** 触发按钮文案 */
  buttonLabel: string;
  /** 生成中提示 */
  loadingLabel?: string;
  /**
   * inline：内容就地展开（适合空间充足的页面，如仪表盘）；
   * modal：生成后弹出独立窗口展示全文（适合卡片等空间受限处，如学习卡背面）。
   */
  display?: 'inline' | 'modal';
  /** modal 模式弹窗标题 */
  title?: string;
}

/** 折叠阈值：inline 模式下内容超过该高度时收起 */
const COLLAPSE_MAX = 360;

/** AI 分析结果容器：触发按钮 + 加载态 + Markdown 渲染 + 长内容折叠 / 弹窗展示 */
export default function AiResult({ generate, buttonLabel, loadingLabel, display = 'inline', title }: AiResultProps) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // inline 模式：新内容生成后重置折叠状态并测量是否超高
  useEffect(() => {
    if (!content) {
      setOverflowing(false);
      return;
    }
    setExpanded(false);
    const el = boxRef.current;
    if (el) setOverflowing(el.scrollHeight > COLLAPSE_MAX);
  }, [content]);

  // modal 模式：Esc 关闭弹窗
  useEffect(() => {
    if (display !== 'modal' || !modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [display, modalOpen]);

  if (!hasAiKey()) {
    return (
      <div className="mt-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        🤖 AI 功能未启用，请先在
        <Link to="/settings" className="mx-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
          设置
        </Link>
        页填入 API Key
      </div>
    );
  }

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await generate();
      setContent(text);
      // modal 模式：生成完成自动弹出全文窗口
      if (display === 'modal') setModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  // ---- modal 模式：弹窗展示全文，卡片内只留按钮 ----
  if (display === 'modal') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={loading}
          className="btn-gradient rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? (loadingLabel ?? '生成中…') : content ? '🧠 重新生成助记' : buttonLabel}
        </button>
        {content && !loading && (
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-xl px-3 py-2 text-xs font-medium text-brand-600 transition hover:bg-brand-50 dark:hover:bg-brand-900/40"
          >
            📖 查看助记
          </button>
        )}
        {error && <span className="w-full text-xs text-red-600">❌ {error}</span>}
        {modalOpen &&
          createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
              onClick={() => setModalOpen(false)}
            >
              <div
                className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title ?? '🧠 AI 助记'}</h3>
                  <button
                    onClick={() => setModalOpen(false)}
                    className="rounded-full p-1 text-lg leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
                <div
                  className="ai-markdown space-y-2 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                  dangerouslySetInnerHTML={{ __html: mdToHtml(content ?? '') }}
                />
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                  <button
                    onClick={() => void run()}
                    disabled={loading}
                    className="rounded-xl px-3 py-1.5 text-xs font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-brand-900/40"
                  >
                    {loading ? '生成中…' : '🔁 重新生成'}
                  </button>
                  <button
                    onClick={() => setModalOpen(false)}
                    className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    );
  }

  // ---- inline 模式：就地展开 + 长内容折叠（仪表盘等空间充足场景）----
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={loading}
          className="btn-gradient rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? (loadingLabel ?? '生成中…') : buttonLabel}
        </button>
        {content && (
          <button
            onClick={() => void run()}
            disabled={loading}
            className="rounded-xl px-3 py-2 text-xs text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
          >
            🔁 重新生成
          </button>
        )}
      </div>
      {error && <div className="mt-2 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/50 dark:text-red-300">❌ {error}</div>}
      {content && (
        <div className="mt-3">
          <div
            ref={boxRef}
            className="relative overflow-hidden rounded-2xl border border-brand-100 bg-brand-soft-gradient text-sm leading-relaxed text-slate-700 dark:border-brand-900/50 dark:bg-slate-900/80 dark:text-slate-300"
            style={{ maxHeight: expanded ? undefined : COLLAPSE_MAX }}
          >
            <div className="ai-markdown space-y-2 p-4" dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />
            {overflowing && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-brand-50 to-transparent dark:from-slate-900" />
            )}
          </div>
          {overflowing && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 rounded-xl px-3 py-1.5 text-xs font-medium text-brand-600 transition hover:bg-brand-50 dark:hover:bg-brand-900/40"
            >
              {expanded ? '收起 ▴' : '展开全部 ▾'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
