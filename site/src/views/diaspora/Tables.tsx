/** Table views: the accessible twin of the map (same numbers, no hover needed). */
import { useState } from 'react';
import { countryName } from '../../data/taxonomy';
import type { Metro } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { frenchQuebec, shareText } from './model';
import type { FlowArc, MetroRow } from './model';

const regionOf = (m: Metro) => (m.country === 'CA' ? frenchQuebec(m.region) : countryName(m.country));

export function MetroTable({ rows, total, caption, selectedId, nameOf, onSelect, pageSize = 25 }: {
  rows: MetroRow[]; total: number; caption: string; selectedId: string | null;
  nameOf(m: Metro): string; onSelect(id: string): void; pageSize?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, pageSize);
  return (
    <div className="dsp-table-wrap">
      <table className="dsp-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Metro area</th>
            <th scope="col" className="dsp-table__hide-sm">Province / state</th>
            <th scope="col">Country</th>
            <th scope="col" className="num">People</th>
            <th scope="col" className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.metro.id} className={r.metro.id === selectedId ? 'is-selected' : undefined}>
              <td className="num">{i + 1}</td>
              <th scope="row">
                <button type="button" className="dsp-link" onClick={() => onSelect(r.metro.id)}>{nameOf(r.metro)}</button>
              </th>
              <td className="dsp-table__hide-sm">{frenchQuebec(r.metro.region)}</td>
              <td>{countryName(r.metro.country)}</td>
              <td className="num">{fmtInt(r.n)}</td>
              <td className="num">{shareText(r.n, total)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="dsp-muted">No metro area has enough people in this filter to show.</td></tr>
          )}
        </tbody>
      </table>
      {rows.length > pageSize && (
        <button type="button" className="dsp-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? `Show top ${pageSize}` : `Show all ${fmtInt(rows.length)} metro areas`}
        </button>
      )}
    </div>
  );
}

export function FlowTable({ flows, nameOf, pageSize = 25 }: { flows: FlowArc[]; nameOf(m: Metro): string; pageSize?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? flows : flows.slice(0, pageSize);
  return (
    <div className="dsp-table-wrap">
      <table className="dsp-table">
        <caption>Moves between metro areas: where alumni’s first job was, and where they live now (all alumni)</caption>
        <thead>
          <tr>
            <th scope="col">First job in</th>
            <th scope="col">Live now in</th>
            <th scope="col" className="num">People</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f) => (
            <tr key={f.key}>
              <td>{nameOf(f.from)}<span className="dsp-table__sub">{regionOf(f.from)}</span></td>
              <td>{nameOf(f.to)}<span className="dsp-table__sub">{regionOf(f.to)}</span></td>
              <td className="num">{fmtInt(f.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {flows.length > pageSize && (
        <button type="button" className="dsp-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? `Show top ${pageSize}` : `Show all ${fmtInt(flows.length)} moves`}
        </button>
      )}
    </div>
  );
}
