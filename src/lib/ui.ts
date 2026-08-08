/**
 * 全站共享 UI 样式常量 —— 统一视觉风格的唯一来源。
 *
 * 约定：
 * - 卡片：rounded-2xl + border-slate-200/70 + bg-white + 柔和阴影，深色模式 dark:border-slate-800 dark:bg-slate-900
 * - 主按钮：品牌渐变（浅蓝）；次按钮：描边；危险按钮：红色实心 / 红色描边
 * - 输入框：rounded-xl + focus ring + 深色模式深底
 * - 所有组件一律引用这里，不要手写散落的重复类名。
 */
export const ui = {
  /** 页面大标题 */
  h1: 'text-xl font-bold text-slate-800 dark:text-slate-100',

  /** 区块卡片（标准内边距 p-5） */
  card: 'rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(30,41,59,0.08)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none',

  /** 区块卡片（紧凑 p-4，图表密集场景） */
  cardCompact: 'rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_2px_12px_-4px_rgba(30,41,59,0.08)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none',

  /** 区块标题 */
  sectionTitle: 'text-base font-semibold text-slate-800 dark:text-slate-100',

  /** 区块副标题（小标题，图表卡内） */
  sectionSub: 'font-semibold text-slate-700 dark:text-slate-200',

  /** 区块描述（小字灰） */
  sectionDesc: 'mt-1 text-xs text-slate-400 dark:text-slate-500',

  /** 主按钮（品牌渐变） */
  btnPrimary: 'btn-gradient rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40',

  /** 主按钮（大号 CTA） */
  btnPrimaryLg: 'btn-gradient rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-40',

  /** 次按钮（描边） */
  btnSecondary:
    'rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300',

  /** 次按钮（大号 CTA） */
  btnSecondaryLg: 'rounded-xl border border-slate-200 px-6 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',

  /** 危险按钮（红色实心） */
  btnDanger: 'rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-40',

  /** 危险按钮（红色描边） */
  btnDangerOutline: 'rounded-xl border border-slate-200 px-4 py-2 text-sm text-red-500 transition hover:border-red-300 dark:border-slate-700',

  /** 输入框 */
  input:
    'rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-900/40',

  /** 列表行（设置项 / 词库行等） */
  row: 'rounded-xl border border-slate-200/70 px-4 py-3 dark:border-slate-700',

  /** 空状态卡片 */
  empty:
    'rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500',
};
