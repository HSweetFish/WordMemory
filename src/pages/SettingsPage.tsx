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

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className={ui.card}>
      <h2 className={ui.sectionTitle}>{title}</h2>
      {desc && <p className={ui.sectionDesc}>{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm transition hover:border-brand-300 dark:border-slate-700"
    >
      <span className="text-slate-700 dark:text-slate-200">{label}</span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-gradient' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
      <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
      <span className="flex items-center gap-2">
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
      <h1 className={ui.h1}>⚙️ 设置</h1>

      <Section title="📖 学习配额" desc="控制每天学习量与复习量">
        <div className="space-y-3">
          <NumberField label="每日新词数" value={settings.dailyNewLimit} min={1} max={200} step={1} suffix="个" onChange={(v) => set({ dailyNewLimit: v })} />
          <NumberField label="每组新词数" value={settings.groupSize} min={1} max={50} step={1} suffix="个" onChange={(v) => set({ groupSize: v })} />
          <NumberField label="每日复习上限" value={settings.dailyReviewLimit} min={0} max={1000} step={10} suffix="个" onChange={(v) => set({ dailyReviewLimit: v })} />
          <Toggle checked={settings.autoSpeak} onChange={(v) => set({ autoSpeak: v })} label="🔊 学习时自动朗读单词" />
        </div>
      </Section>

      <Section title="⏰ 学习提醒" desc="应用打开期间到点提醒；系统通知需授权">
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="text-sm text-slate-700 dark:text-slate-200">每日提醒时间</span>
            <input
              type="time"
              value={settings.reminderTime}
              onChange={(e) => set({ reminderTime: e.target.value })}
              className={`${ui.input} px-2 py-1.5`}
            />
          </label>
          <button onClick={() => void onAskNotify()} className={ui.btnSecondary}>
            🔔 开启系统通知（当前：{notifyPerm === 'granted' ? '已开启' : notifyPerm === 'denied' ? '已拒绝' : notifyPerm === 'unsupported' ? '不支持' : '未授权'}）
          </button>
        </div>
      </Section>

      <Section title="🎨 外观">
        <Toggle checked={settings.darkMode} onChange={(v) => set({ darkMode: v })} label="🌙 深色模式" />
      </Section>

      <Section title="🤖 AI 智能分析" desc="接入 OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / 智谱），Key 仅存本浏览器">
        <AiConfigForm />
      </Section>

      <Section title="💾 本地文件同步" desc="把全部数据自动备份到电脑硬盘上的文件夹，浏览器被清除站点数据也不丢">
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
            <p className="text-xs text-slate-400">
              {syncInfo?.connected ? (
                <>
                  ✅ 已连接：文件夹「{syncInfo.folderName ?? '未知'}」
                  {syncInfo.lastSyncAt
                    ? `，上次同步 ${new Date(syncInfo.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                  。每次学习 / 导入后约 3 秒自动写入，离开页面时立即保存。
                </>
              ) : (
                <>选择一个文件夹后，词库、学习记录、统计曲线会全部备份到该文件夹；清站点数据后重新选回即可一键恢复。</>
              )}
            </p>
          </div>
        )}
      </Section>

      <Section title="💾 数据备份" desc="学习记录全部保存在浏览器本地，可随时导出备份">
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
          <button
            onClick={() => {
              if (window.confirm('确定恢复默认设置？不会删除学习数据。')) reset();
            }}
            className={ui.btnDangerOutline}
          >
            ♻️ 恢复默认设置
          </button>
          <button
            onClick={() => void onRebuildStats()}
            disabled={busy === 'rebuild'}
            className={ui.btnSecondary}
          >
            {busy === 'rebuild' ? '重建中…' : '🔧 重建统计数据'}
          </button>
          <button
            onClick={() => void onClearProgress()}
            disabled={busy === 'clear'}
            className={ui.btnDanger}
          >
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
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          「清空学习数据」只清进度、保留词库与设置；「全部重置（仅保留 AI 配置）」删光所有数据并把设置恢复默认，只留 AI 服务商 / Key / Base URL / 模型。默认值：每日新词 {DEFAULT_SETTINGS.dailyNewLimit} 个、每组 {DEFAULT_SETTINGS.groupSize} 个、复习上限 {DEFAULT_SETTINGS.dailyReviewLimit} 个；复习上限设为 0 可关闭当日复习。
        </p>
        {msg && (
          <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300'}`}>
            {msg.text}
          </div>
        )}
      </Section>
    </div>
  );
}
