import { Component } from 'react';
import type { ReactNode } from 'react';
import { ErrorState } from './Status';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

/**
 * A lazy-loaded view whose chunk failed to download (offline, or an open tab after a deploy
 * replaced the hashed file) can't be retried in place: React.lazy caches the rejection.
 */
export function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically/i
    .test(error.message);
}

/** Keeps one broken view from blanking the whole app; navigating away resets it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isChunkLoadError(error)) {
      return (
        <ErrorState
          error={new Error('This page couldn’t be downloaded. The site may have been updated since you opened it.')}
          retry={() => window.location.reload()}
        />
      );
    }
    return <ErrorState error={error} retry={() => this.setState({ error: null })} />;
  }
}
