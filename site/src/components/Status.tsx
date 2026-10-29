import type { ReactNode } from 'react';
import { Button } from './ui/Button';
import { Sticker } from './ui/Sticker';
import './status.css';

/** Shared loading / error / empty states so every view fails the same, friendly way. */
export function Loading({ label = 'Loading data…' }: { label?: string }) {
  return (
    <div className="status status--loading" role="status" aria-live="polite">
      <span className="status__spinner" aria-hidden="true"><span /><span /><span /></span>
      {label}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="status status--error" role="alert">
      <div className="status__card">
        <Sticker tone="lilac" tilt={-5} className="status__sticker" aria-hidden="true">oops</Sticker>
        <p><strong>Something went wrong.</strong> {error.message}</p>
        {retry && <Button variant="primary" onClick={retry}>Try again</Button>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="status status--empty"><div className="status__card status__card--empty">{children}</div></div>;
}
