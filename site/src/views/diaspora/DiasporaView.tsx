/**
 * The Diaspora: where Queen's alumni live now. It opens on the Kingston story (a headline card:
 * how many first jobs in Kingston kept people there, and where the rest went), then a filterable
 * bubble map (degree × program × class) with first-job → home moves, a Canada / Abroad place list
 * and a detail panel per metro, the headline numbers, the countries ranking and "Who leaves
 * Canada". On phones the place lists come before the map (list-first). Filters, the selected
 * metro and the moves toggle live in the URL.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyLink, ProgramPicker, Segmented, Toggle } from '../../components/controls';
import type { PickerOption, SegOption } from '../../components/controls';
import { ErrorState, Loading } from '../../components/Status';
import { Button, Card, Highlight, SectionHeading } from '../../components/ui';
import { useData } from '../../data/load';
import { DIASPORA_COHORTS, LEVELS } from '../../data/taxonomy';
import type { DiasporaCohortId, DiasporaFile, LevelId, Metro } from '../../data/types';
import { fmtInt, fmtPct } from '../../lib/format';
import { useQueryState } from '../../lib/router';
import { SITE } from '../../site.config';
import DiasporaMap from './DiasporaMap';
import type { MapHandle } from './DiasporaMap';
import { smooth, useNarrow } from './hooks';
import { KingstonCard } from './KingstonCard';
import { AbroadPanel, CountriesPanel, MetroDetailPanel, PLACES_PHONE, PLACES_WIDE, PlaceLists, StatRow } from './Panels';
import { FlowTable, MetroTable } from './Tables';
import {
  DEFAULT_FILTER, DEGREE_SHORT, autoTarget, canadaShare, cohortShort, computeStats, countryRows, filterLabel, floorsFrom,
  frenchQuebec, indexViews, kingstonStory, mapSummary, metroIndex, metroRows, normalizeFilter, oneWayToToronto,
  parseCohort, parseLevel, pctText, programsForLevel, qualifiedNames, resolveFlows, resolveView, sameFilter, viewKey,
  whoPhrase,
} from './model';
import type { Filter } from './model';
import './diaspora.css';

const parseMoves = (v: string) => (v === '1' || v === '0' ? v : null);

/**
 * Fuller degree names: the accessible name where they contain the visible label ("JD (law)" for
 * "JD"); otherwise ("Undergraduate" for "Undergrad") Segmented reads them as the description.
 */
const DEGREE_NAME: Partial<Record<LevelId, string>> = {
  all: 'All alumni', undergrad: 'Undergraduate', law: 'JD (law)', medicine: 'MD (medicine)',
};
const DEGREE_TIP: Partial<Record<LevelId, string>> = {
  all: 'All alumni', undergrad: 'Undergraduate', law: 'Law (JD)', medicine: 'Medicine (MD)',
};
const DEGREE_OPTIONS: SegOption<LevelId>[] = LEVELS.map((l) => ({
  value: l.id, label: DEGREE_SHORT[l.id], ariaLabel: DEGREE_NAME[l.id], tooltip: DEGREE_TIP[l.id],
}));

// On phones the short label ("’95–’99") is the accessible name and the full one its description.
const COHORT_OPTIONS: SegOption<DiasporaCohortId>[] = DIASPORA_COHORTS.map((c) => {
  if (c.id === 'all') return { value: c.id, label: 'All', ariaLabel: 'All classes', tooltip: 'All classes' };
  if (c.id === 'pre-1995') {
    return { value: c.id, label: 'Before 1995', short: cohortShort(c.id), ariaLabel: 'Classes before 1995', tooltip: 'Classes before 1995' };
  }
  const full = `Classes of ${c.label}`;
  return { value: c.id, label: c.label, short: cohortShort(c.id), ariaLabel: full, tooltip: full };
});

/** "2025-09" -> "September 2025" (null when missing or malformed). */
function snapshotLabel(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}/.test(raw)) return null;
  const d = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(5, 7)) - 1, 1));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function PageHeading() {
  return (
    <SectionHeading level={1} eyebrow="The Diaspora" title="Where do Queen’s alumni live now?" id="dsp-title" className="dsp-head">
      <p>Each bubble is a city, sized by the alumni who live there today.</p>
    </SectionHeading>
  );
}

export default function DiasporaView() {
  const data = useData('diaspora');
  if (data.status === 'ready') return <div className="dsp"><Diaspora file={data.data} /></div>;
  return (
    <div className="dsp">
      <div className="container dsp-hero"><PageHeading /></div>
      <div className="container">
        {data.status === 'loading' ? <Loading label="Loading the map…" /> : <ErrorState error={data.error} retry={data.retry} />}
      </div>
    </div>
  );
}

/** The summary sentence: the first percentage is the key number (highlighted); later ones are bold. */
function Emphasis({ text }: { text: string }) {
  const parts = text.split(/(<1%|\d+%)/);
  return <>{parts.map((p, i) => (i % 2 ? (i === 1 ? <Highlight key={i}>{p}</Highlight> : <strong key={i}>{p}</strong>) : p))}</>;
}

function Diaspora({ file }: { file: DiasporaFile }) {
  const [levelQ, setLevel] = useQueryState<LevelId>('level', 'all', parseLevel);
  const [programQ, setProgram] = useQueryState<string>('program', 'all');
  const [cohortQ, setCohort] = useQueryState<DiasporaCohortId>('cohort', 'all', parseCohort);
  const [metroQ, setMetro] = useQueryState<string>('metro', '');
  const [movesQ, setMoves] = useQueryState<string>('moves', '0', parseMoves);
  const [showTable, setShowTable] = useState(false);
  const meta = useData('meta');
  const narrow = useNarrow();
  const mapRef = useRef<MapHandle>(null);
  const mapColRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const tablesRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const topHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDetail = useRef(false);
  /** Runs once after the next commit: moves focus when an action removes the control that had it. */
  const afterCommit = useRef<(() => void) | null>(null);

  const metaData = meta.status === 'ready' ? meta.data : null;
  const floors = useMemo(() => floorsFrom(metaData), [metaData]);
  const snapshot = snapshotLabel((metaData as { snapshot?: unknown } | null)?.snapshot);

  const index = useMemo(() => indexViews(file.views ?? []), [file.views]);
  const byId = useMemo(() => metroIndex(file.metros ?? []), [file.metros]);
  const names = useMemo(() => qualifiedNames(file.metros ?? []), [file.metros]);
  const nameOf = useCallback((m: Metro) => names.get(m.id) ?? frenchQuebec(m.name), [names]);
  const allFlows = useMemo(() => resolveFlows(file.flows ?? [], byId), [file.flows, byId]);
  const story = useMemo(() => kingstonStory(file.kingston), [file.kingston]);
  const oneWay = useMemo(() => oneWayToToronto(story, allFlows), [story, allFlows]);

  const filter = useMemo(
    () => normalizeFilter(index, { level: levelQ, program: programQ, cohort: cohortQ }),
    [index, levelQ, programQ, cohortQ],
  );
  const res = useMemo(() => resolveView(index, filter), [index, filter]);
  const shownFilter = res.shown?.filter ?? filter;
  const shownView = res.shown?.view ?? null;
  const rows = useMemo(() => metroRows(shownView, byId), [shownView, byId]);
  const countries = useMemo(() => countryRows(shownView), [shownView]);
  const stats = useMemo(() => computeStats(file, shownFilter, shownView, rows), [file, shownFilter, shownView, rows]);
  const whoFull = whoPhrase(shownFilter);
  const programs = programsForLevel(index, filter.level);
  const zoomable = useMemo(() => new Set((file.metros ?? []).map((m) => m.country)), [file.metros]);
  const moves = movesQ === '1';
  const target = useMemo(() => autoTarget(rows, { moves }), [rows, moves]);
  const summary = mapSummary(shownView, rows, whoFull, nameOf);

  const selectedId = metroQ && byId.has(metroQ) ? metroQ : null;
  const selected = selectedId ? byId.get(selectedId)! : null;
  const selectedIdx = selectedId ? rows.findIndex((r) => r.metro.id === selectedId) : -1;
  const inFilter = selectedIdx >= 0 ? rows[selectedIdx].n : null;

  // Shares for the two place-list headings, from published counts only.
  const caPct = canadaShare(shownView);
  const ab = stats.abroad;
  const abroadShare = ab.kind === 'exact' ? fmtPct(ab.abroad, ab.of) : ab.kind === 'atLeast' ? `at least ${fmtPct(ab.abroad, ab.of)}` : null;

  const programOptions: PickerOption[] = useMemo(() => {
    const all = index.byKey.get(viewKey({ level: filter.level, program: 'all', cohort: 'all' }));
    const list = [...programs].sort((a, b) => (b.n ?? -1) - (a.n ?? -1) || a.program.localeCompare(b.program));
    return [
      { value: 'all', label: 'All programs', n: all?.n ?? null },
      ...list.map((p) => ({ value: p.program, label: p.program, n: p.n })),
    ];
  }, [index, programs, filter.level]);

  const cohortOptions = COHORT_OPTIONS.map((o) => (
    index.byKey.has(viewKey({ ...filter, cohort: o.value }))
      ? o
      : { ...o, disabled: true, reason: 'Too few located alumni to map' }
  ));

  useEffect(() => {
    const run = afterCommit.current;
    if (!run) return;
    afterCommit.current = null;
    run();
  });

  const select = (id: string | null, opts: { reveal?: boolean; focusPanel?: boolean; fromMap?: boolean } = {}) => {
    setMetro(id ?? '');
    if (id) {
      if (opts.reveal) mapColRef.current?.scrollIntoView?.({ behavior: smooth(), block: 'nearest' });
      mapRef.current?.revealMetro(id);
      // Phones: the detail sits above the map, so a tap on a bubble brings it into view.
      if (opts.fromMap && narrow) afterCommit.current = () => sideRef.current?.scrollIntoView?.({ behavior: smooth(), block: 'start' });
    }
    focusDetail.current = !!(id && opts.focusPanel);
  };

  // Move focus into the detail panel when a selection came from a list (not from the map).
  useEffect(() => {
    if (selectedId && focusDetail.current) {
      focusDetail.current = false;
      detailHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [selectedId]);

  /** Close the detail panel and hand focus back to its bubble, or to the place-list heading. */
  const closeDetail = () => {
    const id = selectedId;
    select(null);
    if (!id) return;
    afterCommit.current = () => {
      const bubble = [...document.querySelectorAll<SVGCircleElement>('circle.dsp-bubble')].find((c) => c.dataset.metro === id);
      // On phones the list sits above the map: go back to it rather than jump down to a bubble.
      if (bubble && !narrow) bubble.focus();
      else topHeadingRef.current?.focus();
    };
  };

  const applyFilter = (f: Filter, then?: 'summary' | 'degree') => {
    setLevel(f.level);
    setProgram(f.program);
    setCohort(f.cohort);
    if (then === 'summary') afterCommit.current = () => summaryRef.current?.focus();
    if (then === 'degree') {
      afterCommit.current = () => filtersRef.current?.querySelector<HTMLInputElement>('.dsp-degree input[value="all"]')?.focus();
    }
  };

  const onLevel = (level: LevelId) => {
    setLevel(level);
    if (level === 'all' || !programsForLevel(index, level).some((p) => p.program === filter.program)) setProgram('all');
  };

  const kingstonId = useMemo(
    () => (file.metros ?? []).find((m) => m.name === 'Kingston' && m.country === 'CA')?.id ?? null,
    [file.metros],
  );

  const toMap = (block: ScrollLogicalPosition = 'start') => mapColRef.current?.scrollIntoView?.({ behavior: smooth(), block });

  const showKingston = () => {
    setMoves('1');
    if (kingstonId) setMetro(kingstonId);
    toMap();
    mapRef.current?.zoomToRegion('ontario-quebec');
  };

  const showAllPlaces = () => {
    setShowTable(true);
    afterCommit.current = () => {
      tablesRef.current?.focus({ preventScroll: true });
      tablesRef.current?.scrollIntoView?.({ behavior: smooth(), block: 'start' });
    };
  };

  const shareUrl = () => {
    const p = new URLSearchParams();
    if (filter.level !== 'all') p.set('level', filter.level);
    if (filter.program !== 'all') p.set('program', filter.program);
    if (filter.cohort !== 'all') p.set('cohort', filter.cohort);
    if (selectedId) p.set('metro', selectedId);
    if (moves) p.set('moves', '1');
    const qs = p.toString();
    return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
  };

  const isDefault = sameFilter(filter, DEFAULT_FILTER);
  const missing = !res.view;
  const fromList = (id: string) => select(id, { reveal: !narrow, focusPanel: true });

  const side = (
    <div className="dsp-sidecol" ref={sideRef}>
      <Card as="aside" pad="none" className="dsp-side" aria-label={selected ? `Details for ${nameOf(selected)}` : 'Places'}>
        {selected ? (
          <MetroDetailPanel
            metro={selected}
            detail={file.metroDetail?.[selected.id]}
            inFilter={inFilter}
            filterTotal={shownView?.n ?? 0}
            who={whoFull}
            allAlumni={sameFilter(shownFilter, DEFAULT_FILTER)}
            rank={selectedIdx >= 0 ? { i: selectedIdx + 1, of: rows.length } : null}
            flows={allFlows}
            nameOf={nameOf}
            onClose={closeDetail}
            onSelect={fromList}
            headingRef={detailHeadingRef}
            floors={floors}
          />
        ) : (
          <PlaceLists
            rows={rows}
            who={whoFull}
            nameOf={nameOf}
            onSelect={fromList}
            onShowAll={showAllPlaces}
            headingRef={topHeadingRef}
            limit={narrow ? PLACES_PHONE : PLACES_WIDE}
            canadaShare={caPct != null ? pctText(caPct) : null}
            abroadShare={abroadShare}
            floors={floors}
          />
        )}
      </Card>
    </div>
  );

  const map = (
    <div className="dsp-mapcol" ref={mapColRef}>
      <Card pad="none" className="dsp-mapcard">
        <DiasporaMap
          ref={mapRef}
          rows={rows}
          total={shownView?.n ?? 0}
          who={whoFull}
          flows={moves ? allFlows : null}
          selectedId={selectedId}
          onSelect={(id) => select(id, { fromMap: true })}
          allMetros={file.metros ?? []}
          names={names}
          target={target}
          autoKey={`${viewKey(shownFilter)}|${moves ? 1 : 0}`}
          floor={floors.named}
          actions={(
            <>
              <Toggle
                label="Moves"
                checked={moves}
                onChange={(on) => setMoves(on ? '1' : '0')}
                title="Arrows from where people’s first job was to where they live now"
              />
              <Toggle
                label="Table"
                checked={showTable}
                onChange={setShowTable}
                title="List every place in a table"
                controls={showTable ? 'dsp-tables' : undefined}
              />
              <CopyLink compact ariaLabel="Copy link to this view" url={shareUrl} />
            </>
          )}
        />
      </Card>
    </div>
  );

  return (
    <>
      <div className={`container dsp-hero${story ? ' dsp-hero--card' : ''}`}>
        <PageHeading />
        {story && <KingstonCard story={story} oneWay={oneWay} onShow={showKingston} />}
      </div>

      <div className="container">
        <section className="dsp-filters" aria-label="Filters" ref={filtersRef}>
          <Segmented legend="Degree" fit="fill" options={DEGREE_OPTIONS} value={filter.level} onChange={onLevel} className="dsp-degree" />
          <ProgramPicker
            label="Program"
            hideLabelBelow={640}
            className="dsp-program"
            options={programOptions}
            value={filter.program}
            onChange={setProgram}
            disabled={filter.level === 'all'}
            disabledReason="Choose a degree to pick a program"
          />
          <Segmented legend="Class" fit="fill" options={cohortOptions} value={filter.cohort} onChange={setCohort} className="dsp-class" />
          {!isDefault && (
            <Button size="sm" className="dsp-reset" onClick={() => applyFilter(DEFAULT_FILTER, 'degree')}>Clear filters</Button>
          )}
        </section>

        {missing && (
          <div className="dsp-notice" role="status">
            <p>
              <strong>Too few people to map {filterLabel(filter)} on its own.</strong>{' '}
              Only groups with at least 50 located alumni get a map.
              {res.shown && <> Showing <strong>{filterLabel(res.shown.filter)}</strong> instead.</>}
            </p>
            {res.alternatives.length > 0 && (
              <div className="dsp-notice__alts">
                {res.alternatives.map((alt) => (
                  <button key={`${alt.level}|${alt.program}|${alt.cohort}`} type="button" className="dsp-chip" onClick={() => applyFilter(alt, 'summary')}>
                    {filterLabel(alt)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="dsp-summary" ref={summaryRef} tabIndex={-1} aria-live="polite">
          {summary && <p className="dsp-summary__text"><Emphasis text={summary} /></p>}
          <p className="dsp-summary__meta">{filterLabel(shownFilter)} · {fmtInt(shownView?.n ?? 0)} located</p>
        </div>
      </div>

      <section
        className="container dsp-mapsec"
        aria-label={narrow ? 'Places and map' : 'Map'}
        onKeyDown={(e) => { if (e.key === 'Escape' && selectedId) closeDetail(); }}
      >
        <div className={`dsp-mapgrid${narrow ? ' is-listfirst' : ''}`}>
          {narrow ? <>{side}{map}</> : <>{map}{side}</>}
        </div>

        {showTable && (
          <div id="dsp-tables" className="card dsp-tables" ref={tablesRef} tabIndex={-1} role="region" aria-label="Tables">
            <MetroTable
              rows={rows}
              total={shownView?.n ?? 0}
              caption={`Metro areas where ${whoFull} live now (${fmtInt(rows.length)} places), largest first`}
              selectedId={selectedId}
              nameOf={nameOf}
              onSelect={fromList}
            />
            {moves && <FlowTable flows={allFlows} nameOf={nameOf} />}
          </div>
        )}
      </section>

      <div className="container dsp-statsec">
        <StatRow stats={stats} who={whoFull} floors={floors} />
      </div>

      <div className="container dsp-panels">
        <CountriesPanel
          rows={countries}
          total={shownView?.n ?? 0}
          who={whoFull}
          zoomable={zoomable}
          floors={floors}
          onZoom={(iso2) => {
            toMap();
            mapRef.current?.zoomToCountry(iso2);
          }}
        />
        <AbroadPanel
          abroad={file.abroad ?? { byCohort: [], byProgram: [] }}
          filter={filter}
          floors={floors}
          onPick={(level, program) => {
            applyFilter({ level, program, cohort: 'all' });
            toMap();
          }}
        />
      </div>

      <footer className="container dsp-notes">
        <p>
          <strong>Places are metro areas:</strong> each counts alumni whose LinkedIn profile puts them there today
          {snapshot ? <> (snapshot {snapshot})</> : null}. <strong>Moves</strong> link where someone’s first job was to
          where they live now, across all alumni.
        </p>
        <p>
          {SITE.privacyLine} Places with fewer than {floors.named} people aren’t shown, so parts may not add up exactly
          to their totals.
        </p>
      </footer>
    </>
  );
}
