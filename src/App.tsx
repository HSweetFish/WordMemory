import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import HomePage from '@/pages/HomePage';
import LearnPage from '@/pages/LearnPage';
import ReviewPage from '@/pages/ReviewPage';
import RandomPage from '@/pages/RandomPage';
import BooksPage from '@/pages/BooksPage';
import WordsPage from '@/pages/WordsPage';
import SettingsPage from '@/pages/SettingsPage';

// 仪表盘含 ECharts，按需加载（独立 chunk，仅访问统计页时下载）
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));

export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={<div className="py-20 text-center text-slate-400">加载中…</div>}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/random" element={<RandomPage />} />
            <Route path="/words" element={<WordsPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/books" element={<BooksPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
