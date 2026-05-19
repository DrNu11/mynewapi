'use client';

import React from 'react';

interface State {
  err: Error | null;
}

/**
 * 简单 React Error Boundary。
 * 用在 ConversationView 外层,任何渲染错误都显示在页面上(不让整个 viewer 崩)。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] 渲染崩溃:', err, info);
  }

  render() {
    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-xs">
          <div className="mb-2 flex items-center gap-2 font-semibold text-red-300">
            ⚠️ 渲染崩溃 · 但其他记录不受影响
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-red-200/80">
            {this.state.err.name}: {this.state.err.message}
            {'\n\n'}
            {(this.state.err.stack || '').split('\n').slice(0, 8).join('\n')}
          </pre>
          <button
            onClick={() => this.setState({ err: null })}
            className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-500/20"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
