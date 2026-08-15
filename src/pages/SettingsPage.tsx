import { useRef, useState } from 'react';
import { useEffect } from 'react';
import { useSettings, DEFAULT_SETTINGS } from '@/stores/settings';
import AiConfigForm from '@/components/ai/AiConfigForm';
import { downloadBackup, restoreBackup } from '@/services/dataio';
import { clearLearningProgress, resetAllData } from '@/db/schema';
import { rebuildDailyStats } from '@/services/stats';
import { requestNotificationPermission } from '@/hooks/useReminder';
import { ui } from '@/lib/ui';
import {
  isLocalSyncSupported,
  pickDataFolder,
  syncToFolder,
  restoreFromFolder,
  readBackupFromFolder,
  getSyncStatus,
  disconnectLocalSync,
  scheduleSync,
  type LocalSyncStatus,
} from '@/services/localfile';

function Section({
  title,
  desc,
  extra,
  children,
}: {
  title: string;
  desc?: string;
  /** 标题行右侧的附加控件（如小开关、圆点选择器） */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={ui.card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={ui.sectionTitle}>{title}</h2>
        {extra}
      </div>
      {desc && <p className={ui.sectionDesc}>{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 标题行右侧的小型开关（自动朗读等轻量选项） */
function MiniToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-gradient' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

function NumberField({
  label,
  desc,
  icon,
  span,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  desc?: string;
  icon?: string;
  /** lg 栅格中的列跨度（如 'lg:col-span-3' 主项 / 'lg:col-span-2' 次项），不传则占 1 列 */
  span?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40 ${span ?? ''}`}
    >
      <span className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft-gradient text-lg">
            {icon}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
          {desc && <span className="mt-0.5 block text-xs text-slate-400">{desc}</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
          className={`${ui.input} w-20 px-2 py-1.5 text-right`}
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

/** 设置页：学习配额 / 提醒 / 外观 / AI / 数据备份（步骤 9） */
export default function SettingsPage() {
  const { settings, set, reset, resetExceptAi } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notifyPerm, setNotifyPerm] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const [syncSupported, setSyncSupported] = useState(false);
  const [syncInfo, setSyncInfo] = useState<LocalSyncStatus | null>(null);

  const refreshSync = async () => {
    setSyncInfo(await getSyncStatus());
  };

  useEffect(() => {
    setSyncSupported(isLocalSyncSupported());
    void refreshSync();
  }, []);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    window.setTimeout(() => setMsg(null), 5000);
  };

  const onExport = async () => {
    setBusy('export');
    try {
      await downloadBackup();
      flash(true, '✅ 备份已下载（wordmemory-backup-日期.json）');
    } catch (e) {
      flash(false, `导出失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  const onRestoreFile = async (file: File) => {
    setBusy('restore');
    try {
      const text = await file.text();
      const data = await restoreBackup(text);
      scheduleSync(); // 恢复后同步到本地文件夹，保持一致
      flash(true, `✅ 已恢复备份：${data.userWords.length} 个学习词、${data.reviewLogs.length} 条记录`);
    } catch (e) {
      flash(false, `恢复失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onClearProgress = async () => {
    if (!window.confirm('将删除全部学习进度、答题记录与每日统计。\n\n已安装的词库与你的设置会保留。\n建议先「导出备份」再操作。确定继续？')) return;
    setBusy('clear');
    try {
      await clearLearningProgress();
      scheduleSync(); // 本地文件夹同步文件同步清空，保持一致
      flash(true, '✅ 学习数据已清空，可以重新开始背了');
    } catch (e) {
      flash(false, `清空失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  const onRebuildStats = async () => {
    if (
      !window.confirm(
        '将根据全部答题记录重新计算每日统计（热力图 / 趋势图 / 连续打卡等）。\n\n不会删除任何学习数据，答题记录本身不会改动。确定继续？',
      )
    )
      return;
    setBusy('rebuild');
    try {
      const { days, logs } = await rebuildDailyStats();
      scheduleSync(); // 本地同步文件里的统计一并更新
      flash(true, `✅ 已重建 ${days} 天的统计（依据 ${logs} 条答题记录），图表数据已刷新`);
    } catch (e) {
      flash(false, `重建失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  const onResetKeepAi = async () => {
    if (
      !window.confirm(
        '将删除全部数据：词库、学习进度、答题记录、每日统计、本地同步连接。\n\n所有设置恢复默认，仅保留 AI 配置（服务商 / Key / Base URL / 模型）。\n建议先「导出备份」。确定继续？',
      )
    )
      return;
    setBusy('resetKeepAi');
    try {
      await resetAllData();
      resetExceptAi();
      flash(true, '✅ 已重置全部数据（仅保留 AI 配置），请到「词库」页重新导入并启用词库');
    } catch (e) {
      flash(false, `重置失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  /** 恢复默认设置（只重置设置项，不动学习数据） */
  const onResetSettings = () => {
    if (!window.confirm('确定恢复默认设置？不会删除学习数据。')) return;
    reset();
    flash(true, '✅ 已恢复默认设置（学习数据保留）');
  };


  // ---- 本地文件夹同步 ----
  const onPickFolder = async () => {
    setBusy('pick');
    try {
      const info = await pickDataFolder();
      if (!info) return;
      const backup = await readBackupFromFolder();
      if (backup) {
        const ok = window.confirm(
          `检测到该文件夹已有备份（导出于 ${new Date(backup.exportedAt).toLocaleString('zh-CN')}，含 ${backup.userWords.length} 个学习词）。\n\n恢复会用备份覆盖当前数据；选择「取消」则保留当前数据并备份到该文件夹。确定恢复？`,
        );
        if (ok) {
          await restoreFromFolder();
          flash(true, `✅ 已从文件夹恢复：${backup.userWords.length} 个学习词、${backup.reviewLogs.length} 条记录`);
        } else {
          await syncToFolder();
          flash(true, `✅ 已连接文件夹「${info.name}」并备份当前数据`);
        }
      } else {
        await syncToFolder();
        flash(true, `✅ 已连接文件夹「${info.name}」并完成首次备份`);
      }
      await refreshSync();
    } catch (e) {
      flash(false, `选择/恢复失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  const onSyncNow = async () => {
    setBusy('syncNow');
    try {
      const ok = await syncToFolder();
      if (!ok) throw new Error('未连接文件夹或权限不足');
      flash(true, '✅ 已备份到本地文件夹');
      await refreshSync();
    } catch (e) {
      flash(false, `备份失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  const onRestoreLocal = async () => {
    if (!window.confirm('将从本地文件夹的备份恢复全部数据（词库 / 学习记录 / 统计 / 设置），覆盖当前数据。确定继续？')) return;
    setBusy('restoreLocal');
    try {
      const data = await restoreFromFolder();
      flash(true, `✅ 已从文件夹恢复：${data.userWords.length} 个学习词、${data.reviewLogs.length} 条记录`);
      await refreshSync();
    } catch (e) {
      flash(false, `恢复失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  const onDisconnectSync = async () => {
    if (!window.confirm('断开本地文件夹同步？文件夹里的备份文件会保留，重新选择即可恢复。')) return;
    setBusy('disconnect');
    try {
      await disconnectLocalSync();
      await refreshSync();
      flash(true, '✅ 已断开本地同步（文件夹备份保留）');
    } catch (e) {
      flash(false, `断开失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy('');
    }
  };

  const onAskNotify = async () => {
    const ok = await requestNotificationPermission();
    setNotifyPerm(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
    flash(ok, ok ? '✅ 通知权限已开启，到点会提醒你' : '❌ 通知权限被拒绝，可在浏览器地址栏重新开启');
  };

  return (
    <div className="space-y-5">
      {/* 页头：标题与外观主题圆点平齐一行 */}
      <div className="flex items-center justify-between gap-3">
        <h1 className={ui.h1}>⚙️ 设置</h1>
        <div className="flex shrink-0 items-center gap-1.5" title="外观主题：浅色 / 深色">
          <span className="text-xs text-slate-400">🎨</span>
          <button
            onClick={() => set({ darkMode: false })}
            title="浅色模式"
            aria-pressed={!settings.darkMode}
            className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm transition ${
              !settings.darkMode
                ? 'border-brand-500 bg-white shadow-sm dark:bg-slate-100'
                : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700 dark:text-slate-500'
            }`}
          >
            ☀️
          </button>
          <button
            onClick={() => set({ darkMode: true })}
            title="深色模式"
            aria-pressed={settings.darkMode}
            className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm transition ${
              settings.darkMode
                ? 'border-brand-500 bg-slate-800 shadow-sm'
                : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700 dark:text-slate-500'
            }`}
          >
            🌙
          </button>
        </div>
      </div>

      <Section
        title="📖 学习配额"
        desc="每日配额，以及新学 / 复习的每组数量，均可单独调整"
        extra={
          <MiniToggle label="自动朗读" checked={settings.autoSpeak} onChange={(v) => set({ autoSpeak: v })} />
        }
      >
        <div className="grid gap-3 lg:grid-cols-5">
          <NumberField
            span="lg:col-span-3"
            icon="📖"
            label="每日新词数"
            desc="今天「今日新学」最多学习的新词数"
            value={settings.dailyNewLimit}
            min={1}
            max={200}
            step={1}
            suffix="个"
            onChange={(v) => set({ dailyNewLimit: v })}
          />
          <NumberField
            span="lg:col-span-2"
            icon="🧩"
            label="每组新词数"
            desc="学习页每轮加载的单词数"
            value={settings.groupSize}
            min={1}
            max={50}
            step={1}
            suffix="个"
            onChange={(v) => set({ groupSize: v })}
          />
          <NumberField
            span="lg:col-span-3"
            icon="🔁"
            label="每日复习上限"
            desc="设为 0 表示关闭当日复习（不再出复习词）"
            value={settings.dailyReviewLimit}
            min={0}
            max={1000}
            step={10}
            suffix="个"
            onChange={(v) => set({ dailyReviewLimit: v })}
          />
          <NumberField
            span="lg:col-span-2"
            icon="🔄"
            label="每组复习数"
            desc="复习页每轮加载的单词数（独立于新学）"
            value={settings.reviewGroupSize}
            min={1}
            max={100}
            step={1}
            suffix="个"
            onChange={(v) => set({ reviewGroupSize: v })}
          />
        </div>
      </Section>

      {/* 学习提醒：外观主题已移到页头右侧，不再占板块 */}
      <Section title="⏰ 学习提醒" desc="打开应用期间到点提醒；系统通知需授权">
        <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft-gradient text-lg">🕐</span>
                <span>
                  <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">每日提醒时间</span>
                  <span className="block text-xs text-slate-400">到点后打开应用会弹提醒</span>
                </span>
              </span>
              <input
                type="time"
                value={settings.reminderTime}
                onChange={(e) => set({ reminderTime: e.target.value })}
                className={`${ui.input} px-2 py-1.5`}
              />
            </label>
            <button
              onClick={() => void onAskNotify()}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-3 text-left transition hover:border-brand-300 dark:border-slate-700 dark:bg-slate-800/40"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft-gradient text-lg">🔔</span>
                <span>
                  <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">系统通知</span>
                  <span className="block text-xs text-slate-400">
                    {notifyPerm === 'granted'
                      ? '已开启，到点会提醒你'
                      : notifyPerm === 'denied'
                        ? '已被拒绝，可在浏览器地址栏重新开启'
                        : notifyPerm === 'unsupported'
                          ? '当前浏览器不支持'
                          : '点击授权，到点弹系统通知'}
                  </span>
                </span>
              </span>
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
                  notifyPerm === 'granted'
                    ? 'bg-emerald-500'
                    : notifyPerm === 'denied'
                      ? 'bg-red-400'
                      : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                {notifyPerm === 'granted' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </button>
          </div>
        </Section>

      <Section title="🤖 AI 智能分析" desc="接入 OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / 智谱），Key 仅存本浏览器">
        <AiConfigForm />
      </Section>

      <Section title="💾 数据与同步" desc="学习记录保存在浏览器本地，可导出备份文件，或自动同步到电脑上的文件夹">
        {/* ① 数据备份 */}
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">🗂️ 数据备份</div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => void onExport()} disabled={busy === 'export'} className={ui.btnPrimary}>
              {busy === 'export' ? '导出中…' : '⬇️ 导出备份'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy === 'restore'}
              className={ui.btnSecondary}
            >
              {busy === 'restore' ? '恢复中…' : '⬆️ 恢复备份'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onRestoreFile(f);
              }}
            />
            <button onClick={() => void onRebuildStats()} disabled={busy === 'rebuild'} className={ui.btnSecondary}>
              {busy === 'rebuild' ? '重建中…' : '🔧 重建统计数据'}
            </button>
            <button onClick={onResetSettings} className={ui.btnSecondary}>
              ♻️ 恢复默认设置
            </button>
          </div>
        </div>

        {/* ② 本地文件同步 */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">📁 本地文件同步</div>
          {!syncSupported ? (
            <p className="text-sm text-amber-600">当前浏览器不支持（需 Chrome / Edge 85+）</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void onPickFolder()}
                  disabled={busy === 'pick'}
                  className={ui.btnPrimary}
                >
                  {busy === 'pick' ? '选择中…' : syncInfo?.connected ? '🔄 更换文件夹' : '📁 选择数据文件夹'}
                </button>
                <button
                  onClick={() => void onSyncNow()}
                  disabled={busy === 'syncNow' || !syncInfo?.connected}
                  className={ui.btnSecondary}
                >
                  {busy === 'syncNow' ? '备份中…' : '💾 立即备份'}
                </button>
                <button
                  onClick={() => void onRestoreLocal()}
                  disabled={busy === 'restoreLocal' || !syncInfo?.connected}
                  className={ui.btnSecondary}
                >
                  {busy === 'restoreLocal' ? '恢复中…' : '⬆️ 从文件夹恢复'}
                </button>
                {syncInfo?.connected && (
                  <button
                    onClick={() => void onDisconnectSync()}
                    disabled={busy === 'disconnect'}
                    className={ui.btnDangerOutline}
                  >
                    {busy === 'disconnect' ? '断开中…' : '🔌 断开连接'}
                  </button>
                )}
              </div>
              {syncInfo?.connected ? (
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <span className="font-medium">✅ 已连接：文件夹「{syncInfo.folderName ?? '未知'}」</span>
                  {syncInfo.lastSyncAt
                    ? ` · 上次同步 ${new Date(syncInfo.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                  <div className="mt-0.5 text-emerald-600/80 dark:text-emerald-400/80">
                    每次学习 / 导入后约 3 秒自动写入，离开页面时立即保存。
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  选择一个文件夹后，词库、学习记录、统计曲线会全部备份到该文件夹；清站点数据后重新选回即可一键恢复。
                </p>
              )}
            </div>
          )}
        </div>

        {/* ③ 危险操作 */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="mb-2 text-sm font-semibold text-red-500 dark:text-red-400">⚠️ 危险操作</div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => void onClearProgress()} disabled={busy === 'clear'} className={ui.btnDanger}>
              {busy === 'clear' ? '清空中…' : '🗑️ 清空学习数据'}
            </button>
            <button
              onClick={() => void onResetKeepAi()}
              disabled={busy === 'resetKeepAi'}
              className={ui.btnDanger}
            >
              {busy === 'resetKeepAi' ? '重置中…' : '🧹 全部重置（仅保留 AI 配置）'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            「清空学习数据」只清进度、保留词库与设置；「全部重置（仅保留 AI 配置）」删光所有数据并把设置恢复默认。
          </p>
        </div>

        {/* 默认值说明（与「恢复默认设置」相关） */}
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          默认值：每日新词 {DEFAULT_SETTINGS.dailyNewLimit} 个、每组新词 {DEFAULT_SETTINGS.groupSize} 个、每组复习{' '}
          {DEFAULT_SETTINGS.reviewGroupSize} 个、复习上限 {DEFAULT_SETTINGS.dailyReviewLimit} 个；复习上限设为 0 可关闭当日复习。
        </p>
      </Section>

      {/* 操作结果反馈：页面级固定提示，任何板块的操作都能看到 */}
      {msg && (
        <div
          className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            msg.ok ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
