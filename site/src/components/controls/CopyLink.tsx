import { useEffect, useId, useRef, useState } from 'react';
import './controls.css';

export interface CopyLinkProps {
  /** Link to copy. A function is called at click time. Default: the current page URL. */
  url?: string | (() => string);
  /** Visible text. Default "Copy link". */
  label?: string;
  /** Accessible name; must contain the visible label (e.g. "Copy link to this view"). Default: `label`. */
  ariaLabel?: string;
  /** Icon only under 640px (the accessible name is unchanged). */
  compact?: boolean;
  /**
   * Which edge of the button the copy-by-hand panel lines up with: 'end' (default, it opens
   * leftwards from the right edge) suits buttons on the right of the page; 'start' suits buttons
   * near the left edge, where an end-aligned panel would run off-screen.
   */
  align?: 'start' | 'end';
  /** Extra class on the wrapper. */
  className?: string;
}

/** Async Clipboard API. Resolves false when it's missing (http, old browsers) or refused. */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or insecure context: the caller shows the link instead */
  }
  return false;
}

type Mode = 'idle' | 'copied' | 'manual';

/**
 * "Copy link" button. Copies with the Clipboard API and says "Link copied" (visibly and through a
 * polite live region); where copying isn't allowed it opens a small panel with the link selected
 * in a read-only field, to copy by hand (Escape, Done or a click outside closes it and focus
 * returns to the button). 36px tall; 44px under 640px.
 */
export function CopyLink({ url, label = 'Copy link', ariaLabel, compact, align = 'end', className }: CopyLinkProps) {
  const uid = useId();
  const [mode, setMode] = useState<Mode>('idle');
  const [copies, setCopies] = useState(0);
  const [manualUrl, setManualUrl] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // "Copied" reverts after a moment (restarting on every copy).
  useEffect(() => {
    if (mode !== 'copied') return;
    const t = setTimeout(() => setMode('idle'), 2400);
    return () => clearTimeout(t);
  }, [mode, copies]);

  // Manual fallback: select the link; a click outside closes the panel.
  useEffect(() => {
    if (mode !== 'manual') return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMode('idle');
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [mode]);

  const closeManual = () => {
    setMode('idle');
    btnRef.current?.focus();
  };

  const onClick = async () => {
    if (mode === 'manual') { closeManual(); return; }
    const link = typeof url === 'function' ? url() : url ?? window.location.href;
    if (await writeToClipboard(link)) {
      setCopies((c) => c + 1);
      setMode('copied');
    } else {
      setManualUrl(link);
      setMode('manual');
    }
  };

  const copied = mode === 'copied';
  return (
    <div
      ref={wrapRef}
      className={`copylink${compact ? ' copylink--compact' : ''}${align === 'start' ? ' copylink--start' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        ref={btnRef}
        type="button"
        className="copylink__btn"
        data-state={mode}
        aria-label={ariaLabel ?? label}
        aria-controls={mode === 'manual' ? `${uid}-panel` : undefined}
        onClick={onClick}
      >
        <svg className="copylink__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          {copied
            ? <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            : (
              <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
                <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
              </g>
            )}
        </svg>
        <span className="copylink__text" aria-hidden="true">{copied ? 'Copied' : label}</span>
      </button>
      {mode === 'manual' && (
        <div
          id={`${uid}-panel`}
          className="copylink__panel"
          role="group"
          aria-labelledby={`${uid}-label`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeManual(); }
          }}
        >
          <label id={`${uid}-label`} htmlFor={`${uid}-input`} className="copylink__label">
            Copy this link
          </label>
          <div className="copylink__row">
            <input
              ref={inputRef}
              id={`${uid}-input`}
              className="copylink__input"
              type="text"
              readOnly
              value={manualUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="copylink__done" onClick={closeManual}>Done</button>
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? `Link copied${copies % 2 ? '' : ' '}` : ''}
      </span>
    </div>
  );
}
