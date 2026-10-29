/**
 * "Share" and "Save image" for a program: the link is its share page (/p/<slug>/), whose preview
 * is the program's card, and which opens the Career Twin student view.
 *
 *   Phones with the Web Share API: the system share sheet (title + link).
 *   Everywhere else: copies the link, exactly like CopyLink (it is CopyLink, labelled "Share").
 *   "Save image" downloads the card itself (/share/<slug>.jpg).
 *
 * 36px tall, 44px under 640px, like the other controls.
 */
import { useState } from 'react';
import { CopyLink, useMediaQuery, writeToClipboard } from '../../components/controls';
import { Button, LinkButton } from '../../components/ui';
import type { Level } from './model';
import { cardFileName, cardImagePath, programSlug, sharePagePath } from './shareLinks';
import './shareProgram.css';

/** A phone or tablet: where the share sheet is the natural way to pass a link on. */
const TOUCH = '(pointer: coarse)';

export interface ShareProgramProps {
  level: Level;
  program: string;
  /** "Commerce at Queen’s": the share title and part of each control's accessible name. */
  title: string;
  className?: string;
}

/** Absolute URL of a program's share page. */
export function shareLink(level: Level, program: string): string {
  return new URL(sharePagePath(programSlug(level, program)), window.location.origin).href;
}

export function ShareProgram({ level, program, title, className }: ShareProgramProps) {
  const slug = programSlug(level, program);
  const touch = useMediaQuery(TOUCH);
  const native = touch && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const [copies, setCopies] = useState(0);
  const link = () => shareLink(level, program);

  const share = async () => {
    try {
      await navigator.share({ title, url: link() });
    } catch (err) {
      // Closing the share sheet isn't a failure; anything else falls back to copying.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (await writeToClipboard(link())) setCopies((c) => c + 1);
    }
  };

  return (
    <div className={`share-program${className ? ` ${className}` : ''}`} role="group" aria-label={`Share ${title}`}>
      {native ? (
        <Button size="sm" onClick={share} aria-label={`Share ${title}`} className="share-program__btn">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10V2.5M5 5.2 8 2.3l3 2.9" />
              <path d="M5.5 7.5H4a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5a1 1 0 0 0-1-1h-1.5" />
            </g>
          </svg>
          {copies > 0 ? 'Copied' : 'Share'}
        </Button>
      ) : (
        <CopyLink url={link} label="Share" ariaLabel={`Share ${title}: copy its link`} align="start" />
      )}
      <LinkButton
        href={cardImagePath(slug)}
        download={cardFileName(slug)}
        size="sm"
        className="share-program__save"
        aria-label={`Save image of the ${title} card`}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2.5V10M5 7.2l3 2.9 3-2.9" />
            <path d="M3 11.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.5" />
          </g>
        </svg>
        Save image
      </LinkButton>
      {native && (
        <span className="sr-only" aria-live="polite">{copies > 0 ? `Link copied${copies % 2 ? '' : ' '}` : ''}</span>
      )}
    </div>
  );
}
