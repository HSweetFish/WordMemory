import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initLocalSync } from '@/services/localfile';
import { migrateLegacyFirstReviewDue } from '@/services/study';
import '@/styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 本地文件夹同步：启动时静默备份一次，离开页面时立即落盘（未配置则无操作）
initLocalSync();

// 排程迁移：旧版本新词首次复习排到「24 小时后」，改为「明天 0 点」后，
// 把昨天学的、尚未首次复习的卡片提前到今天，当天即可复习（幂等，无旧数据则无操作）
void migrateLegacyFirstReviewDue();

// PWA：生产环境注册 Service Worker（离线缓存，词库数据缓存优先）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 注册失败不影响使用（仅失去离线能力） */
    });
  });
}
