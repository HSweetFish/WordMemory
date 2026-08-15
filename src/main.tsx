import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initLocalSync } from '@/services/localfile';
import { migrateLegacyFirstReviewDue, alignDueToDayStart } from '@/services/study';
import { rebuildDailyStats } from '@/services/stats';
import '@/styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 本地文件夹同步：启动时静默备份一次，离开页面时立即落盘（未配置则无操作）
initLocalSync();

// 排程迁移：①旧版本新词首次复习排到「24 小时后」，改为「明天 0 点」后，
// 把昨天学的、尚未首次复习的卡片提前到今天，当天即可复习（幂等，无旧数据则无操作）
void migrateLegacyFirstReviewDue();
// ②历史排程 due 是「复习时刻 + N 天」的精确时间戳，对齐到其所在日 0 点，
// 让「当天到期」的词当天 0 点后即可见，避免上午复习完、晚上又陆续冒出来（幂等）
void alignDueToDayStart();
// ③统计口径迁移：daily_stats 的复习计数从「次数」改为「按词去重」（回炉补考不重复计），
// 并修复旧增量口径下「首答没学会、再答对」的新学少计；启动时按日志全量重建（幂等）
void rebuildDailyStats();

// PWA：生产环境注册 Service Worker（离线缓存，词库数据缓存优先）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 注册失败不影响使用（仅失去离线能力） */
    });
  });
}
