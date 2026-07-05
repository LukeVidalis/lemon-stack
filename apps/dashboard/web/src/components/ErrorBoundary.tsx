import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="rounded-xl border border-bad/40 bg-panel p-5 min-h-[8rem] flex flex-col gap-2 text-sm">
        <p className="text-bad font-medium">Card failed to render</p>
        <p className="text-muted text-xs font-mono">{this.state.error.message}</p>
      </div>
    );
  }
}
