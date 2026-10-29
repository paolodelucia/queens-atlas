import { Card, Sticker } from '../../components/ui';
import { fmtPct } from '../../lib/format';
import { familyLabel, groupColor } from './model';
import type { ThenNowRow } from './model';

const pts = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '±0');

/**
 * "Then vs now": each big field's share right after graduating (hollow dot) and today (filled dot),
 * on one shared scale, sorted by change. A dry margin note sits on the corner when the data backs one.
 */
export function ThenNow({ rows, note, className }: { rows: ThenNowRow[]; note: string | null; className?: string }) {
  if (!rows.length) return null;
  const top = Math.max(...rows.flatMap((r) => [r.a, r.b]));
  const max = Math.min(1, Math.max(0.1, Math.ceil(top * 10 + 1e-9) / 10));
  const at = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <Card as="section" className={`thennow${className ? ` ${className}` : ''}`} aria-labelledby="thennow-h">
      {note && <Sticker className="thennow__sticker" tone="lime" tilt={5}>{note}</Sticker>}
      <h2 id="thennow-h" className="thennow__title">Then vs now</h2>
      <p className="thennow__dek">Share of the class in each of the biggest fields, right after graduating and today. Biggest gain first.</p>
      <p className="thennow__key" aria-hidden="true">
        <span className="thennow__dot thennow__dot--then" /> right after graduating
        <span className="thennow__dot thennow__dot--now" /> today
      </p>
      <ul className="thennow__rows" role="list">
        {rows.map((r) => {
          const lo = Math.min(r.a, r.b);
          const hi = Math.max(r.a, r.b);
          return (
            <li key={r.group} className="thennow__row">
              <span className="thennow__name">{familyLabel(r.group)}</span>
              <span className="thennow__track" aria-hidden="true">
                <span className="thennow__line" style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})`, background: groupColor(r.group) }} />
                <span className="thennow__dot thennow__dot--then" style={{ left: at(r.a) }} />
                <span className="thennow__dot thennow__dot--now" style={{ left: at(r.b), background: groupColor(r.group) }} />
              </span>
              <span className="thennow__vals num">
                <span className="sr-only">{fmtPct(r.a, 1)} right after graduating, {fmtPct(r.b, 1)} today, </span>
                <span aria-hidden="true">{fmtPct(r.a, 1)} → {fmtPct(r.b, 1)}</span>
              </span>
              <span className={`thennow__pts num${r.pts > 0 ? ' is-up' : r.pts < 0 ? ' is-down' : ''}`}>
                {pts(r.pts)}<span className="thennow__unit"> {Math.abs(r.pts) === 1 ? 'pt' : 'pts'}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="thennow__scale" aria-hidden="true"><span>0%</span><span>{Math.round(max * 100)}%</span></p>
    </Card>
  );
}
