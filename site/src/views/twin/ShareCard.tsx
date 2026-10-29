/**
 * A program's share card: 1200x630, the size link previews use, in the zine style of
 * public/og.png. Rendered by the card page (scripts/share-card.html) and screenshotted by
 * scripts/cards.mjs. The numbers are the student hero's own (`entry.hero.stats`, from
 * programHero), drawn with the same StatBlock, so the card and the page can't disagree.
 */
import { useLayoutEffect, useRef } from 'react';
import { StatBlock } from '../../components/ui';
import { SITE } from '../../site.config';
import { fmtInt } from '../../lib/format';
import { SMALL_NOTE, isSmall } from './model';
import type { ShareEntry } from './share';
import './shareCard.css';

/** Title sizes to try, largest first, until the name fits in two lines. */
const TITLE_SIZES = [96, 88, 80, 72, 66, 60, 54];

export function ShareCard({ entry, classes, snapshot }: { entry: ShareEntry; classes: string; snapshot: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLUListElement>(null);
  const { hero } = entry;
  const name = entry.program;

  // Shrink a long name until it fits two lines and leaves room above the stats (jsdom has no
  // layout, so there the first size stays).
  useLayoutEffect(() => {
    const h = titleRef.current;
    const head = headRef.current;
    if (!h || !head) return;
    for (const size of TITLE_SIZES) {
      h.style.fontSize = `${size}px`;
      const twoLines = h.getBoundingClientRect().height <= size * 0.98 * 2 + 6;
      const room = statsRef.current ? statsRef.current.getBoundingClientRect().top - head.getBoundingClientRect().bottom : Infinity;
      if (twoLines && room >= 28) break;
    }
  }, [name]);

  return (
    <article className="share-card" aria-label={entry.title} data-slug={entry.slug}>
      <div className="share-card__blob" aria-hidden="true" />
      <div className="share-card__dots" aria-hidden="true" />
      <header className="share-card__top">
        <span className="share-card__brand">
          <svg className="share-card__mark" width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="5" y="5" width="25" height="25" rx="7" fill="var(--lilac)" />
            <rect x="2" y="2" width="25" height="25" rx="7" fill="var(--lime)" stroke="var(--ink-1)" strokeWidth="2.5" />
            <path fill="var(--ink-1)" fillRule="evenodd" d="M12.6 7h3.8L22 22h-3.8l-1.1-3h-5.2l-1.1 3H7zM14.5 12.05l1.55 4.15h-3.1z" />
          </svg>
          {SITE.name}
        </span>
        <span className="share-card__tool">Career Twin</span>
      </header>

      <div className="share-card__head" ref={headRef}>
        {entry.levelPill && <p className="share-card__pill">{entry.levelPill}</p>}
        <h1 className="share-card__title" ref={titleRef}>
          {name} <span className="share-card__at">at Queen’s</span>
        </h1>
        <p className="share-card__n">
          <span><strong className="num">{fmtInt(hero.group.n)}</strong> grads · {classes.replace(/^Classes/, 'classes')}</span>
          {isSmall(hero.group.n) && <span className="share-card__small">{SMALL_NOTE}</span>}
        </p>
      </div>

      {hero.stats.length > 0 && (
        <ul ref={statsRef} className={`share-card__stats share-card__stats--n${hero.stats.length}`} aria-label="Headline numbers">
          {hero.stats.map((s, i) => (
            <StatBlock key={s.id} as="li" size="md" value={s.value} label={s.text} detail={s.detail} highlight={i === 0} className="share-card__stat" />
          ))}
        </ul>
      )}

      <footer className="share-card__foot">
        <span>Groups only. Numbers lightly nudged. Not affiliated with Queen’s.</span>
        {snapshot && <span className="share-card__snap">LinkedIn snapshot, {snapshot}</span>}
      </footer>
    </article>
  );
}
