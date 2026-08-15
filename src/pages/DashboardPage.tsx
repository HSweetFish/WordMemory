import { useEffect, useState } from 'react';
import type { EChartsCoreOption } from '@/lib/echarts';
import Chart from '@/components/Chart';
import {
  getHeatmapData,
  getTrendData,
  getMasteryData,
  getForgettingCurveData,
  getBookProgress,
  getWeakWordData,
  getPosDistribution,
  getDashboardSummary,
  heatmapRange,
  type HeatmapPoint,
  type TrendPoint,
  type MasterySlice,
  type ForgettingCurveData,
  type BookProgress,
  type WeakWordItem,
  type DashboardSummary,
} from '@/services/dashboard';
import { dateKey, shiftDateKey, shiftWeek, shiftMonth, weekLabel, monthLabel } from '@/lib/format';
import { ui } from '@/lib/ui';
import AiResult from '@/components/ai/AiResult';
import { generatePeriodReport, analyzeWeakWords, type ReportKind } from '@/services/ai';

const MONTHS_CN = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 打卡热力图切换：全部 / 新学 / 复习 */
const HEAT_TABS: { value: 'all' | 'learn' | 'review'; label: string; icon: string }[] = [
  { value: 'all', label: '全部', icon: '🔥' },
  { value: 'learn', label: '新学', icon: '📖' },
  { value: 'review', label: '复习', icon: '🔁' },
];

/**
 * 热力图颜色映射：非线性拉伸指数（P ≥ 1，1 = 线性）。
 * ECharts visualMap 在值域 [min, max] 上均匀插值颜色；为让「高打卡数」区间
 * 颜色层次更丰富（用户每天新学+复习合计 200+，需区分 200/300/400 的差异）、
 * 低打卡数区间压缩，先把数值做幂变换再映射（P 越大高值区拉伸越强，
 * 1.5 ≈ 立方根倒数效果）。色条标签与 tooltip 均逆变换回原始值展示。
 */
const HEAT_POWER = 1.5;
const heatScale = (v: number) => Math.pow(v, HEAT_POWER);
const heatScaleInv = (v: number) => Math.round(Math.pow(v, 1 / HEAT_POWER));

/** 统计页：可视化仪表盘 */
export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapPoint[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [mastery, setMastery] = useState<MasterySlice[]>([]);
  const [curve, setCurve] = useState<ForgettingCurveData | null>(null);
  const [books, setBooks] = useState<BookProgress[]>([]);
  const [weak, setWeak] = useState<WeakWordItem[]>([]);
  const [pos, setPos] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  // 热力图口径切换：全部 = 新学 + 复习；可单独看新学或复习
  const [heatTab, setHeatTab] = useState<'all' | 'learn' | 'review'>('all');
  // AI 周期报告：类型 + 历史偏移（0=当前周期，-1=上周/上月…）
  const [reportKind, setReportKind] = useState<ReportKind>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  // AI 学习报告弹窗开关：入口在热力图卡片头部，按需弹出，不占页面常驻布局
  const [reportOpen, setReportOpen] = useState(false);

  const reportOffset = reportKind === 'week' ? weekOffset : monthOffset;
  const setReportOffset = (n: number) =>
    reportKind === 'week' ? setWeekOffset(n) : setMonthOffset(n);
  const canGoPrev = reportKind === 'week' ? weekOffset > -25 : monthOffset > -11;
  const canGoNext = reportKind === 'week' ? weekOffset < 0 : monthOffset < 0;
  const reportLabel = (() => {
    const today = dateKey();
    if (reportKind === 'week') {
      const start = shiftWeek(today, weekOffset);
      return weekLabel(start, shiftDateKey(start, 6));
    }
    return monthLabel(shiftMonth(today, monthOffset));
  })();

  const load = async () => {
    setLoading(true);
    const [s, h, t, m, c, b, w, p] = await Promise.all([
      getDashboardSummary(),
      getHeatmapData(),
      getTrendData(30),
      getMasteryData(),
      getForgettingCurveData(),
      getBookProgress(),
      getWeakWordData(10),
      getPosDistribution(),
    ]);
    setSummary(s);
    setHeatmap(h);
    setTrend(t);
    setMastery(m);
    setCurve(c);
    setBooks(b);
    setWeak(w);
    setPos(p);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  // ---- 图表 option ----
  // 热力图当前口径取值：全部=新学+复习，或单独新学/复习
  const heatmapValue = (h: HeatmapPoint) =>
    heatTab === 'all' ? h.count : heatTab === 'learn' ? h.newCount : h.reviewCount;
  const heatmapMax = Math.max(1, ...heatmap.map(heatmapValue));
  const heatmapOption: EChartsCoreOption = {
    tooltip: {
      formatter: (p: unknown) => {
        const d = p as { data: [string, number] };
        const pt = heatmap.find((h) => h.date === d.data[0]);
        if (!pt) return d.data[0];
        // 「全部」显示新学/复习明细；单独口径显示对应数值
        if (heatTab === 'all') return `${d.data[0]}：新学 ${pt.newCount} 词 · 复习 ${pt.reviewCount} 词`;
        return `${d.data[0]}：${heatTab === 'learn' ? `新学 ${pt.newCount}` : `复习 ${pt.reviewCount}`} 词`;
      },
    },
    visualMap: {
      min: 0,
      max: heatScale(heatmapMax),
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['#e0f2fe', '#bae6fd', '#38bdf8', '#0369a1'] },
      text: ['多', '少'],
      textStyle: { color: '#94a3b8' },
      // 色条端点/手柄数值逆变换回原始打卡数显示
      formatter: (v: number) => String(heatScaleInv(v)),
    },
    calendar: {
      top: 30,
      left: 30,
      right: 10,
      bottom: 30,
      range: heatmapRange(),
      cellSize: ['auto', 15],
      itemStyle: { borderWidth: 2, borderColor: '#fff', borderRadius: 3 },
      splitLine: { show: false },
      yearLabel: { show: false },
      dayLabel: { firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六'], color: '#94a3b8' },
      monthLabel: { nameMap: MONTHS_CN, color: '#64748b' },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: heatmap.map((h) => [h.date, heatScale(heatmapValue(h))] as [string, number]),
      },
    ],
  };

  const trendOption: EChartsCoreOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['新学', '复习词', '正确率'], bottom: 0 },
    grid: { left: 40, right: 45, top: 15, bottom: 40 },
    xAxis: {
      type: 'category',
      data: trend.map((t) => t.date.slice(5).replace('-', '/')),
      axisLabel: { fontSize: 10, color: '#94a3b8' },
    },
    yAxis: [
      { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      { type: 'value', min: 0, max: 100, splitLine: { show: false }, axisLabel: { formatter: '{value}%' } },
    ],
    series: [
      { name: '新学', type: 'line', data: trend.map((t) => t.learn), smooth: true, areaStyle: { opacity: 0.1 }, itemStyle: { color: '#0ea5e9' } },
      { name: '复习词', type: 'line', data: trend.map((t) => t.review), smooth: true, areaStyle: { opacity: 0.1 }, itemStyle: { color: '#10b981' } },
      { name: '正确率', type: 'line', yAxisIndex: 1, data: trend.map((t) => t.correctRate), smooth: true, showSymbol: false, lineStyle: { type: 'dashed' }, itemStyle: { color: '#f97316' } },
    ],
  };

  const masteryOption: EChartsCoreOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 词 ({d}%)' },
    // 名称图例横排在环下方居中（宽度限制内自动换行，窄卡两行展示不截断）
    // 百分比移入图例（「名称 xx%」），环内不再放标签，视觉更干净
    legend: {
      orient: 'horizontal',
      bottom: 0,
      left: 'center',
      width: '95%',
      icon: 'circle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { fontSize: 12, color: '#64748b' },
      formatter: (name: string) => {
        const total = mastery.reduce((s, m) => s + m.value, 0);
        const item = mastery.find((m) => m.name === name);
        const pct = item && total > 0 ? Math.round((item.value / total) * 100) : 0;
        return `${name} ${pct}%`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['38%', '62%'],
        center: ['50%', '46%'],
        data: mastery.map((m) => ({ name: m.name, value: m.value, itemStyle: { color: m.color } })),
        // 显式关闭外部标签：ECharts 饼图 label 默认 show:true/outside（带引导线箭头），
        // 窄卡中会把名称截断成省略号；信息已由底部图例（名称 xx%）承载
        label: { show: false },
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      },
    ],
  };

  const curveOption: EChartsCoreOption = {
    tooltip: { trigger: 'item', formatter: (p: unknown) => {
      const d = p as { data: number[]; seriesName: string };
      const [x, y, samples] = d.data;
      return d.seriesName === '记忆保持率'
        ? `学习后第 ${x} 天：保持率 ${y}%（样本 ${samples ?? '-'}）`
        : `FSRS 理论：间隔 ${x} 天 → ${y}%`;
    } },
    legend: { data: ['记忆保持率', 'FSRS 理论'], bottom: 0 },
    grid: { left: 45, right: 20, top: 15, bottom: 40 },
    xAxis: { type: 'value', name: '学习后天数', nameTextStyle: { color: '#94a3b8' }, min: 0, max: 30 },
    yAxis: { type: 'value', name: '保持率 %', min: 0, max: 100, splitLine: { lineStyle: { color: '#f1f5f9' } } },
    series: [
      {
        name: '记忆保持率',
        type: 'line',
        data: curve?.actual.map((p) => [p.days, p.successRate, p.samples] as number[]) ?? [],
        showSymbol: true,
        symbolSize: 8,
        itemStyle: { color: '#0ea5e9' },
        lineStyle: { color: '#0ea5e9', width: 2 },
        areaStyle: { opacity: 0.08 },
      },
      {
        name: 'FSRS 理论',
        type: 'line',
        data: curve?.theoretical ?? [],
        smooth: true,
        showSymbol: false,
        lineStyle: { type: 'dashed', color: '#f97316', width: 2 },
      },
    ],
  };

  const weakOption: EChartsCoreOption = {
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; dataIndex: number };
        const w = weak[weak.length - 1 - p.dataIndex]; // 横向条形图 y 轴反转，dataIndex 与 weak 顺序相反
        if (!w) return `${p.name}：${p.value} 次`;
        const detail = [`没记住 ${w.againCount} 次`];
        if (w.hardCount > 0) detail.push(`模糊 ${w.hardCount} 次`);
        return `${p.name}：${p.value} 次（${detail.join(' · ')}）`;
      },
    },
    grid: { left: 70, right: 25, top: 10, bottom: 25 },
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f1f5f9' } } },
    yAxis: { type: 'category', data: weak.map((w) => w.name).reverse(), axisLabel: { fontSize: 12 } },
    series: [
      {
        type: 'bar',
        data: [...weak].reverse().map((w) => w.wrongCount),
        barMaxWidth: 16,
        itemStyle: { color: '#ef4444', borderRadius: 8 },
      },
    ],
  };

  // 词性分布（横向条形图：浅蓝渐变 + 占比 tooltip；「其他」灰色区分）
  const posTotal = pos.reduce((s, p) => s + p.value, 0);
  const posOption: EChartsCoreOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const arr = params as { name: string; value: number }[];
        const p = arr[0];
        const pct = posTotal > 0 ? ((p.value / posTotal) * 100).toFixed(1) : '0.0';
        return `${p.name}：${p.value} 个 · ${pct}%`;
      },
    },
    grid: { left: 8, right: 32, top: 10, bottom: 24, containLabel: true },
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f1f5f9' } } },
    yAxis: {
      type: 'category',
      data: pos.map((p) => p.name).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        data: [...pos].reverse().map((p) => ({
          value: p.value,
          itemStyle: {
            borderRadius: [0, 8, 8, 0],
            color:
              p.name === '其他'
                ? '#cbd5e1'
                : {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 1,
                    y2: 0,
                    colorStops: [
                      { offset: 0, color: '#7dd3fc' },
                      { offset: 1, color: '#0284c7' },
                    ],
                  },
          },
        })),
        barMaxWidth: 18,
        showBackground: true,
        backgroundStyle: { color: 'rgba(148,163,184,0.08)', borderRadius: [0, 8, 8, 0] },
      },
    ],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className={ui.h1}>📊 学习统计</h1>
        <button
          onClick={() => void load()}
          disabled={loading}
          className={ui.btnSecondary}
        >
          {loading ? '加载中…' : '🔄 刷新'}
        </button>
      </div>

      {/* 汇总卡片：已学单词与今日复习词并列大卡，连续打卡与累计答题小卡 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-12">
        {[
          { label: '已学单词', value: summary?.learnedWords ?? '—', icon: '📖', span: 'lg:col-span-4', big: true },
          { label: '今日复习词', value: summary?.todayReview ?? '—', icon: '🔁', span: 'lg:col-span-4', big: true },
          { label: '连续打卡', value: summary ? `${summary.streak} 天` : '—', icon: '🔥', span: 'lg:col-span-2', accent: true },
          { label: '累计答题', value: summary?.totalLogs ?? '—', icon: '✍️', span: 'lg:col-span-2' },
        ].map((card) => (
          <div key={card.label} className={`${ui.cardCompact} card-hover ${card.span}`}>
            <div
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white shadow-sm ${
                card.accent ? 'bg-accent-gradient' : 'bg-brand-gradient'
              }`}
            >
              {card.icon}
            </div>
            <div className={`mt-2 font-bold text-slate-800 dark:text-slate-100 ${card.big ? 'text-2xl' : 'text-lg'}`}>
              {card.value}
            </div>
            <div className="text-xs text-slate-400">{card.label}</div>
          </div>
        ))}
      </div>

      {summary && summary.learnedWords === 0 ? (
        <div className={ui.empty}>
          <div className="text-4xl">🌱</div>
          <p className="mt-2">还没有学习记录，先去「学习」页背几个单词吧</p>
        </div>
      ) : (
        <>
          {/* 打卡热力图(宽) + 词库进度(窄)：热力图按自然周展示，右侧放词库进度与报告入口 */}
          <div className="grid gap-4 lg:grid-cols-12">
            <section className={`${ui.cardCompact} lg:col-span-8`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className={ui.sectionSub}>🔥 打卡热力图（近 12 周）</h2>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
                    {HEAT_TABS.map((tab) => (
                      <button
                        key={tab.value}
                        onClick={() => setHeatTab(tab.value)}
                        className={`rounded-full px-3 py-1 text-xs transition ${
                          heatTab === tab.value
                            ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                      >
                        {tab.icon} {tab.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setReportOpen(true)}
                    className="rounded-full bg-brand-gradient px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90"
                    title="按周/月生成 AI 学习报告"
                  >
                    🤖 报告
                  </button>
                </div>
              </div>
              <Chart option={heatmapOption} height={200} />
            </section>
            <section className={`${ui.cardCompact} lg:col-span-4`}>
              <h2 className={`mb-2 ${ui.sectionSub}`}>📚 词库进度</h2>
              {books.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">暂未安装词库</p>
              ) : (
                <div className="space-y-3">
                  {books.map((b) => {
                    const pct = b.total > 0 ? Math.round((b.learned / b.total) * 100) : 0;
                    return (
                      <div key={b.id}>
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm text-slate-600 dark:text-slate-300" title={b.name}>
                            {b.name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {b.learned}/{b.total} · {pct}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="progress-gradient h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* 记忆保持率(宽) + 掌握度(窄) */}
          <div className="grid gap-4 lg:grid-cols-12">
            <section className={`${ui.cardCompact} lg:col-span-8`}>
              <h2 className={`mb-1 ${ui.sectionSub}`}>⏳ 个人记忆保持率</h2>
              <p className="mb-2 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                折线 = 个人记忆保持率（学习后第 D 天仍未遗忘的比例），
                <br />
                虚线 = FSRS 理论（平均稳定性{curve?.avgStability ? ` ${curve.avgStability.toFixed(1)} 天` : ' —'}）
              </p>
              <Chart option={curveOption} height={240} />
            </section>
            <section className={`${ui.cardCompact} lg:col-span-4`}>
              <h2 className={`mb-2 ${ui.sectionSub}`}>🧠 掌握度分布</h2>
              <Chart option={masteryOption} height={230} />
            </section>
          </div>

          {/* 近 30 天趋势：整宽 */}
          <section className={ui.cardCompact}>
            <h2 className={`mb-2 ${ui.sectionSub}`}>📈 近 30 天趋势</h2>
            <Chart option={trendOption} height={260} />
          </section>

          {/* 薄弱词(宽) + 词性分布(宽) */}
          <div className="grid gap-4 lg:grid-cols-12">
            <section className={`${ui.cardCompact} lg:col-span-6`}>
              <h2 className={`mb-2 ${ui.sectionSub}`}>💪 薄弱词 Top 10</h2>
              {weak.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">暂无答错记录，继续保持！</p>
              ) : (
                <>
                  <Chart option={weakOption} height={Math.max(140, weak.length * 36)} />
                  <AiResult buttonLabel="🤖 AI 分析薄弱词" loadingLabel="AI 诊断中…" generate={() => analyzeWeakWords()} />
                </>
              )}
            </section>
            <section className={`${ui.cardCompact} lg:col-span-6`}>
              <h2 className={`mb-2 ${ui.sectionSub}`}>🏷️ 词性分布（已学）</h2>
              <Chart option={posOption} height={280} />
            </section>
          </div>
        </>
      )}

      {/* AI 学习报告弹窗：入口在热力图卡片头部（🤖 报告），按需弹出，不占页面常驻布局 */}
      {reportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setReportOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className={ui.sectionTitle}>🤖 AI 学习报告</h2>
                <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                  按自然周（周一至周日）/ 自然月统计，由 AI 生成表现总结与下期建议
                </p>
              </div>
              <button
                onClick={() => setReportOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              {/* 周/月切换 */}
              <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                {(['week', 'month'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setReportKind(k)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      reportKind === k
                        ? 'bg-brand-gradient text-white'
                        : 'text-slate-500 hover:text-brand-600 dark:text-slate-400'
                    }`}
                  >
                    {k === 'week' ? '周报' : '月报'}
                  </button>
                ))}
              </div>
              {/* 历史周期导航 */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReportOffset(reportOffset - 1)}
                  disabled={!canGoPrev}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300"
                  title="上一个周期"
                >
                  ◀
                </button>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {reportLabel}
                  {reportOffset === 0 && <span className="ml-1.5 text-xs text-brand-500">当前</span>}
                </span>
                <button
                  onClick={() => setReportOffset(reportOffset + 1)}
                  disabled={!canGoNext}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300"
                  title="下一个周期"
                >
                  ▶
                </button>
              </div>
            </div>
            <AiResult
              buttonLabel={`生成${reportKind === 'week' ? '周报' : '月报'}`}
              loadingLabel="AI 分析中…"
              generate={() => generatePeriodReport(reportKind, reportOffset)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
