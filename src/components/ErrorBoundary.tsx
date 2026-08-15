import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ui } from '@/lib/ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 全局错误边界：捕获路由/组件渲染异常，避免整站白屏。
 * 错误不吞掉，console.error 记录堆栈（本地应用无上报需求）。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary] 页面渲染异常：', error);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const summary = this.state.error.message.slice(0, 120) + (this.state.error.message.length > 120 ? '…' : '');
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className={`${ui.card} w-full max-w-md text-center`}>
          <div className="text-5xl">😵</div>
          <h1 className="mt-4 text-lg font-semibold text-slate-800 dark:text-slate-100">页面出错了</h1>
          <p className="mt-2 break-all text-sm text-slate-400 dark:text-slate-500">{summary}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button type="button" onClick={this.retry} className={ui.btnPrimary}>
              重试
            </button>
            <Link to="/" onClick={this.retry} className={ui.btnSecondary}>
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
