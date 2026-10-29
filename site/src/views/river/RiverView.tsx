import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyLink, ProgramPicker, Segmented, Toggle } from '../../components/controls';
import type { SegOption } from '../../components/controls';
import { ErrorState, Loading } from '../../components/Status';
import { Button, Card, Highlight, SectionHeading } from '../../components/ui';
import { useData } from '../../data/load';
import { COHORTS, LEVELS } from '../../data/taxonomy';
import type { CohortId, LevelId, RiverFile, StageId } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { Link, useQueryState, useRouter } from '../../lib/router';
import { SITE } from '../../site.config';
import { useElementWidth } from './hooks';
import {
  DEFAULT_FILTERS, DEFAULT_TAB, FIELD_FLOOR, SMALL_CLASS, buildSankeyInput, canonicalProgram, cohortPhrase,
  cohortsWithSlice, fallbackCohort, firstAndLast, levelsWithProgram, parseTab, pickSlice, populationLabel,
  programExists, programKey, programTag, programsForLevel, resolveFilters, rollUpSlice, sliceTitle, snapshotLabel,
  stickerNote, summaryParts, thenVsNow, yearList, yearSeries,
} from './model';
import type { Alternative, Filters, RiverTab, ViewSlice } from './model';
import { RiverChart } from './RiverChart';
import { RiverTable } from './RiverTable';
import { MorphStage } from './MorphStage';
import { RiverTabs, panelId, tabId } from './RiverTabs';
import { ThenNow } from './ThenNow';
import { YearsChart } from './YearsChart';
import { YearsTable } from './YearsTable';
import './river.css';

// The full names are the tooltips, and the accessible names where they contain what's shown
// ("Law (JD)" for "Law"); otherwise ("Grad", "’10–’14" on phones) Segmented reads them as descriptions.
const LEVEL_OPTIONS: SegOption<LevelId>[] = LEVELS.map((l) => ({ value: l.id, label: l.short, ariaLabel: l.label, tooltip: l.label }));

const COHORT_OPTIONS: SegOption<CohortId>[] = COHORTS.map((c) => c.id === 'all'
  ? { value: c.id, label: 'All', ariaLabel: c.label, tooltip: c.label }
  : { value: c.id, label: c.id.replace('-', '–'), short: `’${c.id.slice(2, 4)}–’${c.id.slice(7)}`, ariaLabel: c.label, tooltip: c.label });

type Display = 'chart' | 'table';
const DISPLAY_OPTIONS: SegOption<Display>[] = [{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }];

/** Chart cards narrower than this show first destination → today, with a switch for the years between. */
const NARROW = 560;

/** The chart or table the card's switches change (aria-controls). */
const VIZ_ID = 'river-viz';

export default function RiverView() {
  const data = useData('river');
  return (
    <div className="container river">
      <SectionHeading level={1} eyebrow="The River" title="Where does a graduating class end up?" id="river-title" className="river-head">
        <p>Pick a program and a class. See where they went, from the first job to today.</p>
      </SectionHeading>
      {data.status === 'loading' && <Loading label="Loading career paths…" />}
      {data.status === 'error' && <ErrorState error={data.error} retry={data.retry} />}
      {data.status === 'ready' && <RiverBody river={data.data} />}
    </div>
  );
}

/** `?level=…&program=…&cohort=…&view=…` for in-app links, leaving out defaults. */
function riverQuery(f: Filters, opts: { detail?: boolean; tab?: RiverTab } = {}): string {
  const p = new URLSearchParams();
  if (f.level !== DEFAULT_FILTERS.level) p.set('level', f.level);
  if (f.program !== 'all') p.set('program', f.program);
  if (f.cohort !== DEFAULT_FILTERS.cohort) p.set('cohort', f.cohort);
  if (opts.detail && f.program === 'all') p.set('detail', '1');
  if (opts.tab && opts.tab !== DEFAULT_TAB) p.set('view', opts.tab);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

function RiverBody({ river }: { river: RiverFile }) {
  const [levelQ, setLevelQ] = useQueryState<string>('level', DEFAULT_FILTERS.level);
  const [programQ, setProgramQ] = useQueryState<string>('program', DEFAULT_FILTERS.program);
  // Written through useQueryState (the default class drops out of the URL); read raw, because a
  // link with no class should land on a class this level and program have (resolveFilters).
  const [, setCohortQ] = useQueryState<string>('cohort', DEFAULT_FILTERS.cohort);
  const cohortQ = new URLSearchParams(useRouter().loc.search).get('cohort');
  const [detailQ, setDetailQ] = useQueryState<string>('detail', '0');
  const [tab, setTab] = useQueryState<RiverTab>('view', DEFAULT_TAB, parseTab);
  const [display, setDisplay] = useState<Display>('chart');
  const [allYears, setAllYears] = useState(false);
  const [setCard, cardWidth] = useElementWidth<HTMLElement>();
  const summaryRef = useRef<HTMLDivElement>(null);
  /** Set when an action removes the control that had focus; the next commit moves focus to the summary. */
  const refocus = useRef(false);

  const filters = useMemo(
    () => resolveFilters(river, { level: levelQ, program: programQ, cohort: cohortQ }),
    [river, levelQ, programQ, cohortQ],
  );
  const { level, program, cohort, dropped } = filters;
  const programs = useMemo(() => programsForLevel(river, level), [river, level]);
  const haveCohorts = useMemo(() => cohortsWithSlice(river, level, program), [river, level, program]);
  const pick = useMemo(() => pickSlice(river, level, program, cohort), [river, level, program, cohort]);
  const raw = pick.status === 'ok' ? pick.slice : null;

  // All-program views roll related fields up into sectors unless the visitor asks for every field.
  const detail = detailQ === '1';
  const grouped = program === 'all' && !detail;
  const slice: ViewSlice | null = useMemo(() => (raw ? (grouped ? rollUpSlice(raw) : raw) : null), [raw, grouped]);
  const input = useMemo(() => (slice ? buildSankeyInput(slice) : null), [slice]);
  const series = useMemo(() => (raw ? yearSeries(raw, grouped) : null), [raw, grouped]);
  const thenNow = useMemo(() => (slice ? thenVsNow(slice) : []), [slice]);
  const note = useMemo(() => (slice ? stickerNote(slice) : null), [slice]);

  // Phones: first destination → today by default (no sideways scrolling); the years between on request.
  const middle: StageId[] = input && input.stages.length > 2 ? input.stages.slice(1, -1) : [];
  const canCompact = cardWidth > 0 && cardWidth < NARROW && middle.length > 0;
  const compact = canCompact && !allYears;
  const chartInput = useMemo(() => (input && compact ? firstAndLast(input) : input), [input, compact]);
  const yearsLabel = `Add ${middle.length > 1 ? 'years' : 'year'} ${yearList(middle)}`;

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    summaryRef.current?.focus();
  });

  /** Write filters to the URL (each setter drops the param when it equals the default). */
  const apply = (next: Partial<Filters>, opts: { refocus?: boolean } = {}) => {
    const f: Filters = { level, program, cohort, ...next };
    if (!programExists(river, f.level, f.program)) f.program = 'all';
    // A level or program change never lands on a class without a River.
    if (next.cohort === undefined) f.cohort = fallbackCohort(river, f.level, f.program, f.cohort) ?? f.cohort;
    if (opts.refocus) refocus.current = true;
    setLevelQ(f.level);
    setProgramQ(f.program);
    setCohortQ(f.cohort);
  };

  const cohortOptions = COHORT_OPTIONS.map((o) => (haveCohorts.has(o.value)
    ? o
    : { ...o, disabled: true, reason: `Fewer than ${river.meta.min_slice} people` }));

  const floor = river.meta.k?.field ?? FIELD_FLOOR;
  const who = populationLabel(level, program);
  const when = cohortPhrase(cohort);
  const title = sliceTitle(level, program, cohort);
  const snapshot = snapshotLabel(river.meta.snapshot);
  const summary = slice ? summaryParts(slice, who, when, floor) : null;
  const shareUrl = () => `${window.location.origin}${window.location.pathname}${riverQuery(filters, { detail, tab })}`;
  const small = slice != null && slice.n < SMALL_CLASS;

  return (
    <>
      <section className="river-filters" aria-label="Filters">
        <Segmented legend="Level" fit="fill" options={LEVEL_OPTIONS} value={level} onChange={(v) => apply({ level: v })} />
        <ProgramPicker
          label="Program"
          hideLabelBelow={640}
          className="river-program"
          options={programs}
          value={program}
          onChange={(p) => apply({ program: p })}
          disabled={programs.length <= 1}
          disabledReason="Choose a level to pick a program"
        />
        <Segmented legend="Graduating class" fit="fill" options={cohortOptions} value={cohort} onChange={(v) => apply({ cohort: v })} />
      </section>

      {dropped && (
        <DroppedNotice
          river={river}
          name={dropped}
          level={level}
          cohort={cohort}
          tab={tab}
          onFollow={() => { refocus.current = true; }}
        />
      )}

      <div className="river-summary" ref={summaryRef} tabIndex={-1} aria-live="polite">
        {summary && (
          <p className="river-summary__text">
            {summary[0]}{summary[1] && <Highlight>{summary[1]}</Highlight>}{summary[2]}
          </p>
        )}
        {slice && (
          <p className="river-summary__meta">
            <span>{fmtInt(slice.n)} LinkedIn profiles · snapshot {snapshot}</span>
            {small && <span className="river-small">Small class: shares can jump a few points.</span>}
          </p>
        )}
      </div>

      <Card as="section" pad="none" className="river-card" aria-label="River chart">
        <div className="river-card__inner" ref={setCard}>
          {pick.status === 'missing' ? (
            <Missing
              min={river.meta.min_slice}
              who={who}
              when={when}
              alternatives={pick.alternatives}
              onPick={(a) => apply({ level: a.level, program: a.program, cohort: a.cohort }, { refocus: true })}
            />
          ) : slice && input && chartInput && series ? (
            <>
              <div className="river-card__bar">
                <RiverTabs value={tab} onChange={setTab} />
                <div className="river-card__tools">
                  {program === 'all' && (
                    <Toggle
                      label="Show all fields"
                      short="All fields"
                      checked={detail}
                      onChange={(on) => setDetailQ(on ? '1' : '0')}
                      title="Split each colour into the fields it groups"
                      controls={VIZ_ID}
                    />
                  )}
                  <Segmented legend="View as" hideLegend options={DISPLAY_OPTIONS} value={display} onChange={setDisplay} className="river-display" />
                </div>
                <div className="river-card__copy">
                  <CopyLink compact ariaLabel="Copy link to this view" url={shareUrl} />
                </div>
              </div>
              <div className="river-card__panel" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
                {display === 'chart' ? (
                  <MorphStage
                    tab={tab}
                    resetKey={`${level}|${program}|${cohort}|${grouped ? 'sectors' : 'fields'}|${allYears ? 'all' : 'ends'}|${compact ? 'ends' : 'all'}`}
                    render={(t, m) => (t === 'flow' ? (
                      <>
                        <RiverChart
                          id={m.current ? VIZ_ID : undefined}
                          slice={slice}
                          input={chartInput}
                          sliceKey={`${level}|${program}|${cohort}|${grouped ? 'sectors' : 'fields'}|${allYears ? 'all' : 'ends'}`}
                          snapshot={snapshot}
                          title={title}
                          hiddenStages={compact ? middle : []}
                          floor={floor}
                          still={m.still}
                          onMorphSource={m.onMorphSource}
                        />
                        {canCompact && (
                          <div className="river-card__more">
                            <Toggle label={yearsLabel} checked={allYears} onChange={setAllYears} controls={m.current ? VIZ_ID : undefined} />
                          </div>
                        )}
                      </>
                    ) : (
                      <YearsChart
                        id={m.current ? VIZ_ID : undefined}
                        series={series}
                        title={title}
                        cohort={cohort}
                        snapshot={river.meta.snapshot}
                        snapshotText={snapshot}
                        floor={floor}
                        onMorphSource={m.onMorphSource}
                      />
                    ))}
                  />
                ) : tab === 'flow'
                  ? <RiverTable id={VIZ_ID} slice={slice} input={input} title={title} grouped={grouped} k={floor} />
                  : <YearsTable id={VIZ_ID} series={series} title={title} grouped={grouped} floor={floor} />}
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {slice && (
        <div className="river-below">
          <ThenNow rows={thenNow} note={note} className="river-below__card" />
          <footer className="river-notes">
            {tab === 'flow' ? (
              <p>
                <strong>Flows under {floor} people are hidden.</strong>{' '}
                {slice.suppressed != null
                  ? <>In this view they add up to about {fmtInt(slice.suppressed)} moves between stages, so bars can be taller than the ribbons touching them.</>
                  : <>So bars can be taller than the ribbons touching them.</>}{' '}
                Columns stop at the last year every class in the group has reached.
              </p>
            ) : (
              <p>
                <strong>Each year is out of the people who had reached it.</strong>{' '}
                In a five-year class the later years cover only the earlier classes, so they rest on fewer people.
                Today is everyone, each class at its own year.
              </p>
            )}
            <p>
              {grouped && <><strong>Related fields are grouped</strong> by adding up their counts; turn on <em>Show all fields</em> to split them. </>}
              <strong>No role listed</strong> means nothing on the profile for that point in time.{' '}
              <strong>Smaller groups</strong> combines fields with fewer than {floor} people at a stage; anything still too small isn’t shown.
            </p>
            <p>
              Counts are LinkedIn profiles of Queen’s alumni (snapshot {snapshot}). {SITE.privacyLine}{' '}
              So shares are close, not exact, and may not add up to 100%.
            </p>
          </footer>
        </div>
      )}
    </>
  );
}

/** A filter combination under the minimum size: say why, and offer combinations that exist. */
function Missing({ min, who, when, alternatives, onPick }: {
  min: number; who: string; when: string; alternatives: Alternative[]; onPick: (a: Alternative) => void;
}) {
  return (
    <div className="river-missing" role="status">
      <h2 className="river-missing__title">Not enough people to draw this river</h2>
      <p>
        Fewer than {min} {who} from {when} have a career path in the data, so there’s no chart for
        this combination.
      </p>
      {alternatives.length > 0 && (
        <>
          <p className="river-missing__try">Try one of these instead:</p>
          <ul className="river-missing__alts" role="list">
            {alternatives.map((a) => (
              <li key={`${a.level}|${a.program}|${a.cohort}`}>
                <Button size="sm" className="river-missing__btn" onClick={() => onPick(a)}>
                  <AltLabel label={a.label} /> <span className="river-missing__n num">{fmtInt(a.n)} people</span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** "All master’s & PhD grads, class of 1995–1999": the class stays on one line when the pill wraps. */
function AltLabel({ label }: { label: string }) {
  const cut = label.lastIndexOf(', ');
  if (cut < 0) return <span>{label}</span>;
  return <span>{label.slice(0, cut + 2)}<span className="river-nowrap">{label.slice(cut + 2)}</span></span>;
}

const MAX_ECHO = 60;

/**
 * The URL named a program that has no River at this level (often a link from Career Twin, whose
 * groups start smaller): say so, instead of silently showing the whole level, and link to the
 * places that program does exist.
 */
function DroppedNotice({ river, name, level, cohort, tab, onFollow }: {
  river: RiverFile; name: string; level: LevelId; cohort: CohortId; tab: RiverTab; onFollow: () => void;
}) {
  const meta = useData('meta');
  if (meta.status === 'loading') return null; // decide the wording once, not twice

  const canon = canonicalProgram(river, name);
  const programs = meta.status === 'ready' && Array.isArray(meta.data?.programs) ? meta.data.programs : [];
  const twin = level === 'all' ? undefined : programs.find((p) => p.level === level && programKey(p.program) === programKey(name));
  const display = twin?.program ?? canon ?? name;
  const shown = display.length > MAX_ECHO ? `${display.slice(0, MAX_ECHO - 1)}…` : display;
  const subject = programTag(level, canon || twin ? shown : `“${shown}”`);
  const everyone = populationLabel(level, 'all');

  const elsewhere = canon ? levelsWithProgram(river, canon).filter((l) => l.level !== level) : [];
  let lead: string;
  if (twin) lead = `There’s no River for ${subject}: too few grads have a career path (a River needs ${river.meta.min_slice}).`;
  else if (canon) lead = `There’s no River for ${shown} at this level.`;
  else lead = `There’s no River for ${subject}.`;

  return (
    <Card flat pad="sm" className="river-notice" role="status">
      <p className="river-notice__text">
        <strong>{lead}</strong> Showing all {everyone}.
      </p>
      {(elsewhere.length > 0 || twin) && (
        <ul className="river-notice__links">
          {elsewhere.map((l) => {
            const to: Filters = { level: l.level, program: canon!, cohort: fallbackCohort(river, l.level, canon!, cohort) ?? 'all' };
            return (
              <li key={l.level}>
                <Link to={`/river${riverQuery(to, { tab })}`} onClick={onFollow}>
                  River for {programTag(l.level, canon!)} <span className="river-notice__n num">{fmtInt(l.n)} people</span>
                </Link>
              </li>
            );
          })}
          {twin && (
            <li>
              <Link to={`/twin?${new URLSearchParams({ level: twin.level, program: twin.program }).toString()}`}>
                {twin.program} in Career Twin
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
