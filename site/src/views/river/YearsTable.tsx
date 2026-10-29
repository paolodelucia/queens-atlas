import { yearLabel } from '../../data/taxonomy';
import { fmtInt, fmtPct } from '../../lib/format';
import { FIELD_FLOOR, familyLabel, groupColor, yearTableRows } from './model';
import type { YearSeries } from './model';

/** The year-by-year chart's accessible twin: share of each field at every point, over that point's n. */
export function YearsTable({ id, series, title, grouped, floor = FIELD_FLOOR }: {
  /** Id on the wrapper (the target of the switches' aria-controls). */
  id?: string;
  series: YearSeries;
  title: string;
  /** Rows are sectors of related fields (the rolled-up view). */
  grouped?: boolean;
  /** Smallest published count. */
  floor?: number;
}) {
  const rows = yearTableRows(series);
  const points = series.rows;
  return (
    <div id={id} className="river-tables">
      <div className="river-table-scroll" tabIndex={0} role="region" aria-label="Year-by-year table (scrolls sideways)">
        <table className="river-table river-table--years">
          <caption>
            Share of people in each {grouped ? 'group of related fields' : 'field'}, year by year: {title}.
            Each column is out of the people who had reached that year (the “People” row), so later years
            can cover fewer classes. A dash means fewer than {floor} people, which isn’t published.
          </caption>
          <thead>
            <tr>
              <th scope="col">{grouped ? 'Fields' : 'Field'}</th>
              {points.map((p) => <th scope="col" key={String(p.year)}>{yearLabel(p.year, true)}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="river-table__people">
              <th scope="row">People</th>
              {points.map((p) => <td key={String(p.year)} className="num">{fmtInt(p.n)}</td>)}
            </tr>
            {rows.map((r) => (
              <tr key={r.family}>
                <th scope="row">
                  <span className="river-swatch" style={{ background: groupColor(r.family) }} aria-hidden="true" />
                  {familyLabel(r.family)}
                </th>
                {r.cells.map((v, i) => (
                  <td key={String(points[i].year)}>
                    {v == null
                      ? <span className="river-table__none" title={`Fewer than ${floor} people (not published)`}><span aria-hidden="true">—</span><span className="sr-only">fewer than {floor}</span></span>
                      : <span className="num" title={`${fmtInt(v)} of ${fmtInt(points[i].n)} people`}>{fmtPct(v, points[i].n)}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
