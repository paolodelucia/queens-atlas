import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Card } from '../../components/ui';
import type { ProgramRanking } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { nextTabIndex, rankingNote, rankingTab, rankRows } from './model';

/**
 * Program leaderboards as WAI-ARIA tabs (automatic activation, roving tabindex): arrow keys,
 * Home and End move between tabs, Tab moves into the panel. Each panel is a ranked list whose
 * text carries every value (rank, program, share, hits of n), so the bars never gate a number.
 * Bars are one single-series colour (--data-mono) on every tab, and every program carries its
 * degree level.
 */
export function Leaderboards({ rankings, years, minGrads }: {
  rankings: ProgramRanking[];
  years: { from: number; to: number };
  minGrads: number;
}) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const current = rankings[Math.min(active, rankings.length - 1)];
  const rows = useMemo(() => (current ? rankRows(current) : []), [current]);

  if (!current) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabIndex(active, e.key, rankings.length);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="boards">
      <div className="boards__tabs" role="tablist" aria-label="Program leaderboards">
        {rankings.map((r, i) => (
          <button
            key={r.id}
            ref={(el) => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${base}-tab-${r.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            className="boards__tab"
            onClick={() => setActive(i)}
            onKeyDown={onKeyDown}
          >
            {rankingTab(r)}
          </button>
        ))}
      </div>
      <Card
        className="boards__panel"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${current.id}`}
        tabIndex={0}
      >
        <div className="boards__head">
          <h3>{current.label}</h3>
          <p>{rankingNote(current, years, minGrads)}</p>
        </div>
        <ol className="rank">
          {rows.map((r) => (
            <li key={r.key} className="rank__row">
              <span className="rank__n num" aria-hidden="true">{r.rank}</span>
              <span className="rank__label">
                {r.label.name}
                {r.label.tag && <span className="rank__tag"> ({r.label.tag})</span>}
              </span>
              <span className="rank__bar" aria-hidden="true">
                <span style={{ width: `${Math.max(1.5, r.width * 100)}%` }} />
              </span>
              <span className="rank__value">
                <strong>{r.share}</strong>
                <span className="rank__of num">{fmtInt(r.hits)} of {fmtInt(r.n)}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
