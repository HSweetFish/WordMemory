import { useEffect, useRef } from 'react';
import { useSettings } from '@/stores/settings';
import { dateKey, APP_TIME_ZONE } from '@/lib/format';

/** 东八区 HH:MM 格式化（与设置里的 reminderTime 同语义） */
const REMINDER_TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * 学习提醒 Hook（在 App 打开期间生效）：
 * - 每 30 秒检查一次当前时间是否到达 reminderTime；
 * - 到达后：若浏览器通知权限已授予则发系统通知，同时派发应用内事件（Layout 显示横幅）；
 * - 同一天只提醒一次。
 */
export function useReminder() {
  const { settings } = useSettings();
  const firedRef = useRef('');

  useEffect(() => {
    if (!settings.reminderTime) return;

    const check = () => {
      const now = new Date();
      if (REMINDER_TIME_FMT.format(now) !== settings.reminderTime) return;

      const today = dateKey();
      if (firedRef.current === today) return;
      firedRef.current = today;

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('📚 该背单词啦', {
            body: '今天的单词在等你，打开词忆开始学习吧',
            tag: 'wordmemory-reminder',
          });
        } catch {
          /* 某些环境不允许构造 Notification，忽略 */
        }
      }
      window.dispatchEvent(new CustomEvent('wordmemory:reminder'));
    };

    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [settings.reminderTime]);
}

/** 请求浏览器通知权限（设置页按钮调用） */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}
