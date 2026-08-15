import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSettings } from '@/stores/settings';
import { useReminder } from '@/hooks/useReminder';
import Logo from '@/components/Logo';

const NAV_ITEMS = [
  { to: '/', label: '首页', icon: '🏠', end: true },
  { to: '/learn', label: '学习', icon: '📖' },
  { to: '/review', label: '复习', icon: '🔁' },
  { to: '/words', label: '词表', icon: '🔍' },
  { to: '/dashboard', label: '统计', icon: '📊' },
  { to: '/books', label: '词库', icon: '📚' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

export default function Layout() {
  const { settings } = useSettings();
  const [reminderVisible, setReminderVisible] = useState(false);

  // 深色模式：同步 .dark 类到 <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.darkMode);
  }, [settings.darkMode]);

  // 提醒事件 -> 显示应用内横幅，8 秒后自动消失
  useReminder();
  useEffect(() => {
    const show = () => {
      setReminderVisible(true);
      window.setTimeout(() => setReminderVisible(false), 8000);
    };
    window.addEventListener('wordmemory:reminder', show);
    return () => window.removeEventListener('wordmemory:reminder', show);
  }, []);

  return (
    <div className="min-h-screen">
      {reminderVisible && (
        <div className="bg-brand-gradient-deep fixed inset-x-0 top-0 z-50 px-4 py-3 text-center text-sm font-medium text-white shadow-lg">
          📚 该背单词啦！打开学习页，完成今天的新词与复习
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-lg font-bold tracking-wide text-slate-800 dark:text-slate-100">
              词忆
              <span className="text-brand-gradient ml-1.5 font-semibold">WordMemory</span>
            </span>
          </NavLink>
          <span className="hidden text-xs text-slate-400 sm:block">新学 · 复习 · 遗忘曲线 · AI 分析</span>
        </div>
        <nav className="mx-auto max-w-3xl overflow-x-auto px-2 pb-2">
          <div className="flex gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm transition-all ${
                    isActive
                      ? 'bg-brand-gradient font-medium text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`
                }
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 pt-4 text-center text-xs text-slate-400 dark:text-slate-500">
        数据保存在浏览器本地 · 支持离线使用
      </footer>
    </div>
  );
}
