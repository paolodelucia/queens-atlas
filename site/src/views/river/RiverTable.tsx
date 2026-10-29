import { STAGES } from '../../data/taxonomy';
import { fmtInt, fmtPct } from '../../lib/format';
import { familyLabel, groupColor, tableRows } from './model';
import type { SankeyInput, ViewSlice } from './model';

const stageName = (s: string) => STAGES[s as keyof typeof STAGES]?.label ?? s;

/** The chart's accessible twin: stage × field counts, plus every published flow. */
export function RiverTable({ id, slice, input, title, grouped, k = 10 }: {
  /** Id on the wrapper (the target of the switches' aria-controls). */
  id?: string;
  slice: ViewSlice;
  input: SankeyInput;
  title: string;
  /** Rows are sectors of related fields (the rolled-up view). */
  grouped?: boolean;
  /** Smallest published count. */
  k?: number;
}) {
  const stages = input.stages;
  const rows = tableRows(slice, stages);
  const n = slice.n;

  const pairs = stages.slice(0, -1).map((from, i) => ({ from, to: stages[i + 1] }));
  const flows = pairs
    .map((p) => ({ ...p, links: input.links.filter((l) => l.fromStage === p.from && l.toStage === p.to).sort((a, b) => b.value - a.value) }))
    .filter((p) => p.links.length);

  return (
    <div id={id} className="river-tables">
      <div className="river-table-scroll" tabIndex={0} role="region" aria-label="Table of people by field and stage (scrolls sideways)">
        <table className="river-table">
          <caption>
            People in each {grouped ? 'group of related fields' : 'field'} at each stage: {title} ({fmtInt(n)} people).
            Percentages are shares of the whole class; a dash means fewer than {k} people, which we don’t publish.
          </caption>
          <thead>
            <tr>
              <th scope="col">{grouped ? 'Fields' : 'Field'}</th>
              {stages.map((st) => <th scope="col" key={st}>{stageName(st)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.family}>
                <th scope="row">
                  <span className="river-swatch" style={{ background: groupColor(r.family) }} aria-hidden="true" />
                  {familyLabel(r.family)}
                </th>
                {r.cells.map((v, i) => (
                  <td key={stages[i]}>
                    {v == null
                      ? <span className="river-table__none" title={`Fewer than ${k} people (not published)`}><span aria-hidden="true">—</span><span className="sr-only">fewer than {k}</span></span>
                      : <><span className="num">{fmtInt(v)}</span> <span className="river-table__pct num">{fmtPct(v, n)}</span></>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {flows.length > 0 && (
        <details className="river-flows">
          <summary>All {fmtInt(input.links.length)} published flows between stages</summary>
          <div className="river-table-scroll" tabIndex={0} role="region" aria-label="Table of flows between stages (scrolls sideways)">
            <table className="river-table river-table--flows">
              <caption>Moves between consecutive stages, largest first. Only flows of {k} or more people are published.</caption>
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">People</th>
                </tr>
              </thead>
              {flows.map((p) => (
                <tbody key={p.from}>
                  <tr className="river-table__group">
                    <th scope="colgroup" colSpan={3}>{stageName(p.from)} → {stageName(p.to)}</th>
                  </tr>
                  {p.links.map((l) => (
                    <tr key={l.id}>
                      <td>{familyLabel(l.from)}</td>
                      <td>{familyLabel(l.to)}</td>
                      <td className="num">{fmtInt(l.value)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
