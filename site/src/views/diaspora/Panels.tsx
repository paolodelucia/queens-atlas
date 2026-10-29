/**
 * Everything around the map: the headline stats, the Canada / Abroad place lists (the side panel
 * on wide screens, the first thing under the filters on phones), the selected-metro detail, the
 * countries ranking and "Who leaves Canada". Marks carry colour (single-series bars use
 * --data-mono); text always uses ink tokens; lime and lilac never mark data.
 */
import { useId, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Segmented } from '../../components/controls';
import type { SegOption } from '../../components/controls';
import { Card, StatBlock } from '../../components/ui';
import type { DiasporaFile, Floors, LevelId, Metro, MetroDetail } from '../../data/types';
import { DIASPORA_COHORTS, FAMILY, countryName, familyColor } from '../../data/taxonomy';
import { fmtCompact, fmtInt, fmtPct } from '../../lib/format';
import {
  DEFAULT_FLOORS, abroadByCohort, abroadHeadline, cohortShort, degreeShort, flowsFor, pctText, placeName, rankPrograms,
  shareText, splitPlaces,
} from './model';
import type { CountryRow, Filter, FlowArc, MetroRow, Stats } from './model';

// ── Small building blocks ────────────────────────────────────────────────────

/** A horizontal bar on a faint track: square at the baseline, rounded at the data end. */
export function Bar({ value, max, color = 'var(--data-mono)', overlay }: {
  value: number; max: number; color?: string;
  overlay?: { value: number; color: string };
}) {
  const w = max > 0 ? Math.max(0, Math.min(100, (100 * value) / max)) : 0;
  const ow = overlay && max > 0 ? Math.max(0, Math.min(100, (100 * overlay.value) / max)) : 0;
  return (
    <span className="dsp-bar" aria-hidden="true">
      <span className="dsp-bar__fill" style={{ width: `${w}%`, background: color }} />
      {overlay && <span className="dsp-bar__fill dsp-bar__fill--overlay" style={{ width: `${ow}%`, background: overlay.color }} />}
    </span>
  );
}

/** "Click" with a mouse, "Tap" on touch screens (CSS swaps them on `hover: none`). */
export function ClickTap({ lower }: { lower?: boolean }) {
  return (
    <>
      <span className="dsp-click">{lower ? 'click' : 'Click'}</span>
      <span className="dsp-tap">{lower ? 'tap' : 'Tap'}</span>
    </>
  );
}

/**
 * The short line beside a place in the lists: its province in Canada, its country elsewhere. Empty
 * when the shown name already says it ("Hamilton, Ont.", "London, UK", "Hong Kong").
 */
function placeMeta(m: Metro, shown: string): string {
  if (shown.includes(',')) return '';
  if (m.country === 'CA') return placeName(m).replace(/, Canada$/, '');
  const country = countryName(m.country);
  return country.includes(m.name) ? '' : country;
}

// ── Headline stats ───────────────────────────────────────────────────────────

export function StatRow({ stats, who, floors = DEFAULT_FLOORS }: { stats: Stats; who: string; floors?: Floors }) {
  const a = stats.abroad;
  let abroadValue = '—';
  let abroadSub: ReactNode = 'No data for this filter';
  if (a.kind === 'exact') {
    abroadValue = fmtPct(a.abroad, a.of);
    abroadSub = <>{fmtInt(a.abroad)} people{a.us != null && <> · {fmtPct(a.us, a.of)} in the US</>}</>;
  } else if (a.kind === 'atLeast') {
    abroadValue = `≥ ${fmtPct(a.abroad, a.of)}`;
    abroadSub = 'At least: counts only the countries that can be listed';
  } else if (a.kind === 'suppressed') {
    abroadValue = `< ${floors.field}`;
    abroadSub = 'Too few people to publish';
  } else if (a.kind === 'unlisted') {
    abroadValue = '—';
    abroadSub = `No country outside Canada has ${floors.named} or more of them`;
  }
  return (
    <ul className="dsp-stats" role="list" aria-label={`Headline numbers for ${who}`}>
      <StatBlock as="li" size="md" value={fmtInt(stats.located)} label="located" detail="with a known city or country" />
      <StatBlock as="li" size="md" value={fmtInt(stats.countries)} label="countries" detail={`with ${floors.named} or more of them`} />
      <StatBlock as="li" size="md" value={abroadValue} label="live outside Canada" detail={abroadSub} />
      <StatBlock
        as="li"
        size="md"
        className="dsp-stat--text"
        value={stats.topAbroad ? stats.topAbroad.metro.name : '—'}
        label="top city outside Canada"
        detail={stats.topAbroad
          ? <>{fmtInt(stats.topAbroad.n)} people · {placeName(stats.topAbroad.metro)}</>
          : `No city outside Canada has ${floors.named} or more of them`}
      />
    </ul>
  );
}

// ── Places: In Canada / Abroad ───────────────────────────────────────────────

function PlaceList({ title, share, rows, nameOf, onSelect, empty }: {
  title: string; share: string | null; rows: MetroRow[];
  nameOf(m: Metro): string; onSelect(id: string): void; empty: string;
}) {
  const id = useId();
  const max = rows[0]?.n ?? 0;
  return (
    <div className="dsp-places__group">
      <h3 className="dsp-places__h" id={id}>
        {title}{share && <span className="dsp-places__share num"> · {share}</span>}
      </h3>
      {rows.length === 0 ? (
        <p className="dsp-muted">{empty}</p>
      ) : (
        <ol className="dsp-rank" aria-labelledby={id}>
          {rows.map((r, i) => (
            <li key={r.metro.id}>
              <button type="button" className="dsp-rank__row" onClick={() => onSelect(r.metro.id)}>
                <span className="dsp-rank__i num">{i + 1}</span>
                <span className="dsp-rank__name">{nameOf(r.metro)}<span className="dsp-rank__meta">{placeMeta(r.metro, nameOf(r.metro))}</span></span>
                <span className="dsp-rank__val num">{fmtInt(r.n)}</span>
                <Bar value={r.n} max={max} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Rows per list in the side panel; phones (list-first) show a few more. */
export const PLACES_WIDE = 5;
export const PLACES_PHONE = 8;

/**
 * The places, split into Canada and abroad, each ranked with bars scaled to its own top place
 * (each heading gives that side's share, so the two scales aren't read as one). The full ranking
 * is one click away in the table.
 */
export function PlaceLists({
  rows, who, nameOf, onSelect, onShowAll, headingRef, limit = PLACES_WIDE, canadaShare, abroadShare, floors = DEFAULT_FLOORS,
}: {
  rows: MetroRow[]; who: string; nameOf(m: Metro): string; onSelect(id: string): void;
  /** Open the full table (offered when the lists don't show every place). */
  onShowAll(): void;
  headingRef?: Ref<HTMLHeadingElement>;
  limit?: number;
  /** "87% of them" style shares for the two headings (null hides one). */
  canadaShare: string | null;
  abroadShare: string | null;
  floors?: Floors;
}) {
  const { canada, abroad } = splitPlaces(rows);
  const shownCa = canada.slice(0, limit);
  const shownAb = abroad.slice(0, limit);
  return (
    <div className="dsp-side__inner dsp-places">
      <h2 className="dsp-side__title" ref={headingRef} tabIndex={-1}>Where {who} live</h2>
      {rows.length === 0 ? (
        <p className="dsp-muted">No single city has {floors.named} or more of them; they appear only in the country totals.</p>
      ) : (
        <>
          <PlaceList title="In Canada" share={canadaShare} rows={shownCa} nameOf={nameOf} onSelect={onSelect}
            empty={`No Canadian city has ${floors.named} or more of them.`} />
          <PlaceList title="Abroad" share={abroadShare} rows={shownAb} nameOf={nameOf} onSelect={onSelect}
            empty={`No city outside Canada has ${floors.named} or more of them.`} />
        </>
      )}
      {rows.length > shownCa.length + shownAb.length && (
        <button type="button" className="dsp-more dsp-more--link" onClick={onShowAll}>
          All {fmtInt(rows.length)} places <span aria-hidden="true">→</span>
        </button>
      )}
      <p className="dsp-side__hint"><ClickTap /> a place for what alumni there do.</p>
    </div>
  );
}

// ── Metro detail ─────────────────────────────────────────────────────────────

export function MetroDetailPanel({
  metro, detail, inFilter, filterTotal, who, allAlumni, rank, flows, nameOf, onClose, onSelect, headingRef, floors = DEFAULT_FLOORS,
}: {
  metro: Metro;
  detail: MetroDetail | undefined;
  inFilter: number | null;
  filterTotal: number;
  who: string;
  /** True when the filter is "all alumni, all classes" (then the in-filter and total counts coincide). */
  allAlumni: boolean;
  rank: { i: number; of: number } | null;
  flows: FlowArc[];
  nameOf(m: Metro): string;
  onClose(): void;
  onSelect(id: string): void;
  headingRef?: Ref<HTMLHeadingElement>;
  floors?: Floors;
}) {
  const titleId = useId();
  const families = (detail?.families ?? []).filter(([, n]) => n > 0).slice(0, 8);
  const employers = (detail?.employers ?? []).slice(0, 6);
  const programs = (detail?.programs ?? []).slice(0, 6);
  const order = DIASPORA_COHORTS.map((c) => c.id);
  const cohorts = (detail?.cohorts ?? []).filter(([c, n]) => c !== 'all' && n > 0 && order.includes(c))
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const famMax = families[0]?.[1] ?? 0;
  const cohortMax = Math.max(0, ...cohorts.map(([, n]) => n));
  const moves = flowsFor(flows, metro.id);
  const empty = !families.length && !employers.length && !programs.length && !cohorts.length;
  const name = nameOf(metro);

  return (
    <section className="dsp-side__inner dsp-detail" aria-labelledby={titleId}>
      <div className="dsp-detail__head">
        <div>
          <p className="eyebrow dsp-detail__eyebrow">Selected place</p>
          <h2 className="dsp-side__title" id={titleId} ref={headingRef} tabIndex={-1}>{name}</h2>
          <p className="dsp-detail__place">{placeName(metro)}</p>
        </div>
        <button type="button" className="dsp-close" onClick={onClose} aria-label={`Close details for ${name}`}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="dsp-detail__kpis">
        {allAlumni ? (
          <>
            <div>
              <span className="dsp-detail__kpi num">{fmtInt(metro.n)}</span>
              <span className="dsp-detail__kpilabel">alumni live here</span>
            </div>
            <div>
              <span className="dsp-detail__kpi num">{shareText(metro.n, filterTotal)}</span>
              <span className="dsp-detail__kpilabel">of all located alumni{rank ? <> · #{rank.i} of {fmtInt(rank.of)} places</> : null}</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="dsp-detail__kpi num">{inFilter != null ? fmtInt(inFilter) : `< ${floors.named}`}</span>
              <span className="dsp-detail__kpilabel">
                {who} live here{inFilter != null && <> · {shareText(inFilter, filterTotal)} of them</>}
              </span>
            </div>
            <div>
              <span className="dsp-detail__kpi num">{fmtInt(metro.n)}</span>
              <span className="dsp-detail__kpilabel">alumni of every degree and class live here</span>
            </div>
          </>
        )}
      </div>

      {empty ? (
        <p className="dsp-muted">No group here reaches {floors.named} people, so there’s no breakdown to show.</p>
      ) : (
        <>
          {families.length > 0 && (
            <div className="dsp-detail__block">
              <h3 className="dsp-h3">What they do now</h3>
              <ul className="dsp-list">
                {families.map(([fam, n]) => (
                  <li key={fam} className="dsp-list__row">
                    <span className="dsp-swatch" style={{ background: familyColor(fam) }} aria-hidden="true" />
                    <span className="dsp-list__name">{FAMILY[fam]?.label ?? fam}</span>
                    <span className="dsp-list__val num">{fmtInt(n)}</span>
                    <Bar value={n} max={famMax} color={familyColor(fam)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {employers.length > 0 && (
            <div className="dsp-detail__block">
              <h3 className="dsp-h3">Top employers</h3>
              <ul className="dsp-pills">
                {employers.map((e) => (
                  <li key={e.name}>{e.name} <span className="num">{fmtInt(e.n)}</span></li>
                ))}
              </ul>
            </div>
          )}
          {programs.length > 0 && (
            <div className="dsp-detail__block">
              <h3 className="dsp-h3">Top programs</h3>
              <ul className="dsp-list dsp-list--plain">
                {programs.map((p) => (
                  <li key={`${p.level}|${p.program}`} className="dsp-list__row">
                    <span className="dsp-list__name">{p.program} <span className="dsp-list__meta">{degreeShort(p.level)}</span></span>
                    <span className="dsp-list__val num">{fmtInt(p.n)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cohorts.length > 0 && (
            <div className="dsp-detail__block">
              <h3 className="dsp-h3">Class of…</h3>
              <ol className="dsp-cols" aria-label="Alumni living here by graduating class">
                {cohorts.map(([c, n]) => (
                  <li key={c} className="dsp-cols__col">
                    <span className="dsp-cols__val num" aria-hidden="true">{fmtCompact(n)}</span>
                    <span className="dsp-cols__bar" style={{ height: `${Math.max(4, (100 * n) / cohortMax)}%` }} aria-hidden="true" />
                    <span className="dsp-cols__label">
                      <span aria-hidden="true">{cohortShort(c)}</span>
                      <span className="sr-only">{DIASPORA_COHORTS.find((x) => x.id === c)?.label}: {fmtInt(n)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {(moves.out.length > 0 || moves.in.length > 0) && (
        <div className="dsp-detail__block">
          <h3 className="dsp-h3">Moves</h3>
          <div className="dsp-moves">
            {moves.out.length > 0 && (
              <div>
                <p className="dsp-moves__cap">First job here, live elsewhere now</p>
                <ul className="dsp-list dsp-list--plain">
                  {moves.out.slice(0, 5).map((f) => (
                    <li key={f.key} className="dsp-list__row">
                      <button type="button" className="dsp-link" onClick={() => onSelect(f.to.id)}>→ {nameOf(f.to)}</button>
                      <span className="dsp-list__val num">{fmtInt(f.n)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {moves.in.length > 0 && (
              <div>
                <p className="dsp-moves__cap">Live here now, first job elsewhere</p>
                <ul className="dsp-list dsp-list--plain">
                  {moves.in.slice(0, 5).map((f) => (
                    <li key={f.key} className="dsp-list__row">
                      <button type="button" className="dsp-link" onClick={() => onSelect(f.from.id)}>← {nameOf(f.from)}</button>
                      <span className="dsp-list__val num">{fmtInt(f.n)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="dsp-footnote">
        The profile covers all {fmtInt(metro.n)} alumni living here, whatever the filter. Groups under {floors.named} people are left out.
      </p>
    </section>
  );
}

// ── Countries ranking ────────────────────────────────────────────────────────

export function CountriesPanel({ rows, total, who, onZoom, zoomable, floors = DEFAULT_FLOORS }: {
  rows: CountryRow[]; total: number; who: string; onZoom(iso2: string): void; zoomable: Set<string>; floors?: Floors;
}) {
  const [all, setAll] = useState(false);
  const canada = rows.find((r) => r.iso2 === 'CA');
  const abroad = rows.filter((r) => r.iso2 !== 'CA');
  const shown = all ? abroad : abroad.slice(0, 10);
  const max = abroad[0]?.n ?? 0;
  return (
    <Card as="section" className="dsp-panel dsp-countries" aria-labelledby="dsp-countries-h">
      <p className="eyebrow">Countries</p>
      <h2 id="dsp-countries-h" className="dsp-panel__title">Beyond Canada</h2>
      {canada && (
        <p className="dsp-panel__lede">
          <strong>{fmtPct(canada.n, total)}</strong> of {who} live in Canada ({fmtInt(canada.n)} people). The rest, by country:
        </p>
      )}
      {abroad.length === 0 ? (
        <p className="dsp-muted">No country outside Canada has {floors.named} or more of them.</p>
      ) : (
        <ol className="dsp-rank dsp-rank--countries">
          {shown.map((r, i) => {
            const canZoom = zoomable.has(r.iso2);
            const inner = (
              <>
                <span className="dsp-rank__i num">{i + 1}</span>
                <span className="dsp-rank__name">{r.name}</span>
                <span className="dsp-rank__val num">{fmtInt(r.n)}<span className="dsp-rank__pct">{shareText(r.n, total)}</span></span>
                <Bar value={r.n} max={max} />
              </>
            );
            return (
              <li key={r.iso2}>
                {canZoom
                  ? <button type="button" className="dsp-rank__row" onClick={() => onZoom(r.iso2)}>{inner}<span className="sr-only">. Show on map</span></button>
                  : <div className="dsp-rank__row">{inner}</div>}
              </li>
            );
          })}
        </ol>
      )}
      {abroad.length > 10 && (
        <button type="button" className="dsp-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Show top 10' : `Show all ${abroad.length} countries`}
        </button>
      )}
      <p className="dsp-footnote">Includes people placed in a country but not a city. <ClickTap /> a country to zoom the map.</p>
    </Card>
  );
}

// ── Who leaves Canada ────────────────────────────────────────────────────────

type Metric = 'abroad' | 'us';
const METRIC_OPTIONS: SegOption<Metric>[] = [{ value: 'abroad', label: 'Abroad' }, { value: 'us', label: 'In the US' }];

export function AbroadPanel({ abroad, filter, onPick, floors = DEFAULT_FLOORS }: {
  abroad: DiasporaFile['abroad']; filter: Filter; onPick(level: LevelId, program: string): void; floors?: Floors;
}) {
  const [metric, setMetric] = useState<Metric>('abroad');
  const cohortRows = abroadByCohort(abroad.byCohort ?? []);
  const total = (abroad.byCohort ?? []).find((r) => r.cohort === 'all');
  const axisMax = Math.max(5, Math.ceil(Math.max(0, ...cohortRows.map((r) => r.abroadPct ?? 0)) / 5) * 5);
  const ranked = rankPrograms(abroad.byProgram ?? [], metric, { minN: 200, limit: 10 });
  const rankMax = Math.max(0, ...ranked.map((r) => r.pct));
  const mine = filter.program !== 'all'
    ? (abroad.byProgram ?? []).find((r) => r.level === filter.level && r.program === filter.program) ?? null
    : null;
  const headId = useId();

  return (
    <Card as="section" className="dsp-panel dsp-panel--wide" aria-labelledby="dsp-abroad-h">
      <p className="eyebrow">Who leaves Canada</p>
      <h2 id="dsp-abroad-h" className="dsp-panel__title">{abroadHeadline(cohortRows)}</h2>
      <div className="dsp-abroad">
        <div className="dsp-abroad__cohort">
          <h3 className="dsp-h3">Living abroad, by class</h3>
          <div className="dsp-key" aria-hidden="true">
            <span><i className="dsp-key__sw" style={{ background: 'var(--seq-300)' }} />Outside Canada</span>
            <span><i className="dsp-key__sw" style={{ background: 'var(--seq-600)' }} />…in the US</span>
          </div>
          <ul className="dsp-cohorts">
            {cohortRows.map((r) => (
              <li key={r.cohort} className={`dsp-cohorts__row${filter.cohort === r.cohort ? ' is-current' : ''}`}>
                <span className="dsp-cohorts__label">{r.label}</span>
                <Bar
                  value={r.abroadPct ?? 0}
                  max={axisMax}
                  color="var(--seq-300)"
                  overlay={r.usPct != null && r.abroadPct != null ? { value: r.usPct, color: 'var(--seq-600)' } : undefined}
                />
                <span className="dsp-cohorts__val num" aria-hidden="true">
                  {pctText(r.abroadPct)}<span className="dsp-cohorts__us"> · US {pctText(r.usPct)}</span>
                </span>
                <span className="sr-only">
                  {r.label}: {r.abroad == null ? `fewer than ${floors.field}` : fmtInt(r.abroad)} of {fmtInt(r.n)} living outside Canada
                  {r.us != null ? `, ${fmtInt(r.us)} in the US` : ''}.
                </span>
              </li>
            ))}
          </ul>
          {total && total.abroad != null && (
            <p className="dsp-footnote">
              All classes: {fmtPct(total.abroad, total.n)} abroad, {fmtPct(total.us, total.n)} in the US.
              Recent grads may still be on their way out.
            </p>
          )}
        </div>

        <div className="dsp-abroad__programs">
          <div className="dsp-abroad__head">
            <h3 className="dsp-h3" id={`${headId}-h`}>Programs that travel furthest</h3>
            <Segmented legend="Show share living" hideLegend options={METRIC_OPTIONS} value={metric} onChange={setMetric} className="dsp-metric" />
          </div>
          <ol className="dsp-rank dsp-rank--programs" aria-labelledby={`${headId}-h`}>
            {ranked.map((r, i) => {
              const current = filter.level === r.level && filter.program === r.program;
              return (
                <li key={`${r.level}|${r.program}`}>
                  <button
                    type="button"
                    className={`dsp-rank__row${current ? ' is-current' : ''}`}
                    onClick={() => onPick(r.level, r.program)}
                  >
                    <span className="dsp-rank__i num">{i + 1}</span>
                    <span className="dsp-rank__name">{r.program}<span className="dsp-rank__meta">{degreeShort(r.level)} · {fmtInt(r.n)} located</span></span>
                    <span className="dsp-rank__val num">{pctText(r.pct)}</span>
                    <Bar value={r.pct} max={rankMax} />
                    {/* Visible text stays the start of the accessible name (WCAG 2.5.3). */}
                    <span className="sr-only">
                      {` ${metric === 'us' ? 'in the US' : 'outside Canada'}, ${fmtInt(r.count)} of ${fmtInt(r.n)}. Map this program`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {mine && !ranked.some((r) => r.level === mine.level && r.program === mine.program) && (
            <p className="dsp-pinned">
              Your filter, <strong>{mine.program} ({degreeShort(mine.level)})</strong>:{' '}
              {mine.abroad == null ? `fewer than ${floors.field} abroad` : <><strong>{fmtPct(mine.abroad, mine.n)}</strong> abroad</>}
              {' · '}
              {mine.us == null ? `fewer than ${floors.field} in the US` : <><strong>{fmtPct(mine.us, mine.n)}</strong> in the US</>}
              {' '}({fmtInt(mine.n)} located)
            </p>
          )}
          <p className="dsp-footnote">
            Programs with 200+ located alumni; programs where the count is under {floors.field} are left out, not ranked as zero. <ClickTap /> one to map it.
          </p>
        </div>
      </div>
    </Card>
  );
}
