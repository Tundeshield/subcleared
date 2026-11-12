import { Component, type ReactNode } from 'react';
import { isStaleChunkError } from '../lib/lazyPage';

/** Catches anything a page throws while rendering, so a failure never leaves a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; full?: boolean }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown, info: unknown) { console.error('[page error]', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = isStaleChunkError(this.state.error);
    const box = (
      <div className="max-w-md" role="alert">
        <p className="text-lg font-medium">{stale ? 'SubCleared has been updated' : 'This page didn’t load'}</p>
        <p className="text-muted mt-2">{stale ? 'Reload to use the latest version.' : 'Something went wrong while showing this page.'}</p>
        <div className="mt-5 flex gap-2">
          <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
          {!stale && <button className="btn-secondary" onClick={() => this.setState({ error: null })}>Try again</button>}
        </div>
      </div>
    );
    return this.props.full ? <div className="min-h-screen grid place-items-center p-6">{box}</div> : <div className="py-16">{box}</div>;
  }
}
