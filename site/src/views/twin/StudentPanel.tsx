/**
 * Student view (the default): "What do you study?", then the program's grads: their first stop
 * after Queen's, who hired them first, and where each first job led, year by year. All numbers
 * come from the program's groups (classes of 1995-2024, or 2015-2019 with "recent classes only").
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { CopyLink, ProgramPicker, Segmented, Toggle } from '../../components/controls';
import type { PickerOption } from '../../components/controls';
import { Card, LinkButton, StatBlock, Sticker } from '../../components/ui';
import { LEVEL } from '../../data/taxonomy';
import { fmtInt } from '../../lib/format';
import { Link } from '../../lib/router';
import { SITE } from '../../site.config';
import { ShareBars, TrajectoryChart } from './charts';
import type { BarItem } from './charts';
import { ChoiceChips, LEVEL_FIELD_CLASS, LEVEL_OPTIONS, YearField } from './fields';
import {
  DEFAULT_K, LEVEL_PEOPLE, RECENT_BAND, SMALL_NOTE, STUDENT_EXAMPLES, YEAR_MAX, YEAR_MIN, cohortRange, employerSticker,
  firstStop, firstStopSticker, getGroup, hasRiver, hiddenLine, isSmall, jobChips, pathStats, people, percent, programHero,
  riverHref, shareUrl, snapshotLabel, startPhrase, trajectory, trajectoryNotes, twinQuery, whoPhrase,
} from './model';
import type { First, Level } from './model';
import type { PanelProps } from './panel';
import { ambiguousNames, programTitle } from './shareLinks';
import { ShareProgram } from './ShareProgram';

interface StudentProps extends PanelProps {
  job: First;
  recent: boolean;
  onJob: (f: First) => void;
  onRecent: (on: boolean) => void;
  onExample: (level: Level, program: string) => void;
}

/** How many first stops show before "Show all" (only offered when it would hide three or more). */
const TOP_STOPS = 7;
const MIN_HIDDEN = 3;

export function StudentPanel(props: StudentProps) {
  const { validation: v, index, minGroup, onExample, programsFor } = props;
  const { level, program } = v.answers;
  const hero = level && program ? programHero(index, level, program) : null;
  const group = hero?.group ?? null;

  let announce = '';
  if (hero && level && program) {
    const top = hero.stats[0];
    announce = `${fmtInt(hero.group.n)} ${whoPhrase(level, program)}${top ? `: ${top.value} ${top.text}` : ''}. Results are below.`;
  }
  const examples = STUDENT_EXAMPLES.filter((e) => programsFor(e.level).some((o) => o.program === e.program));

  return (
    <>
      <StudentForm {...props} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>
      <div className="twin-anchor">
        {level && program && group ? (
          <StudentResults {...props} level={level} program={program} />
        ) : level && program ? (
          <Card className="twin-empty">
            <p>Fewer than {minGroup} {whoPhrase(level, program)} are in the data, so there’s nothing to show for it yet.</p>
          </Card>
        ) : (
          <Card as="section" className="twin-empty" aria-labelledby="twin-empty-h">
            <h2 id="twin-empty-h" className="twin-empty__title">{level ? 'Now pick a program' : 'Pick a degree and a program'}</h2>
            <p className="twin-empty__lede">
              You’ll see where its grads went first, who hired them, and where each first job led, year by year. Or start with one of these:
            </p>
            <ul className="twin-examples">
              {examples.map((e) => (
                <li key={e.label}>
                  <button type="button" className="twin-example" onClick={() => onExample(e.level, e.program)}>
                    <span className="twin-example__try">Try</span> {e.label}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function StudentForm({ validation: v, programs, yearRaw, formRef, onLevel, onProgram, onYear }: StudentProps) {
  const { level, program, year } = v.answers;
  const single = level != null && programs.length === 1;
  const options: PickerOption[] = programs.map((o) => ({ value: o.program, label: o.program, n: o.n }));
  const programHint = level == null ? 'Programs depend on the degree.'
    : single ? 'The only program at this level.' : `${programs.length} programs, largest first.`;
  const yearHint = year == null
    ? 'Optional. It doesn’t change the numbers.'
    : year > YEAR_MAX
      ? `The data runs to the class of ${YEAR_MAX}, so these are the people before you.`
      : year < YEAR_MIN
        ? `The data starts with the class of ${YEAR_MIN}.`
        : 'Already graduated? “I’ve graduated” finds your exact twins.';

  return (
    <Card as="section" className="twin-form" aria-labelledby="twin-form-h">
      <h2 id="twin-form-h" className="twin-form__h">What do you study?</h2>
      <form ref={formRef} aria-labelledby="twin-form-h" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <div className="twin-form__row">
          <Segmented
            legend="Degree"
            fit="fill"
            className={LEVEL_FIELD_CLASS}
            options={LEVEL_OPTIONS}
            value={level ?? ''}
            onChange={(val) => { if (val) onLevel(val); }}
          />
          <div className="twin-form__program">
            <ProgramPicker
              id="twin-program"
              label="Program"
              options={options}
              value={program}
              onChange={onProgram}
              disabled={level == null || single}
              disabledReason={level == null ? 'Pick a degree first' : 'The only program at this level'}
              describedBy="twin-program-hint"
              placeholder={level == null ? 'Pick a degree first' : 'Start typing, e.g. Economics'}
            />
            <p className="twin-hint" id="twin-program-hint">{programHint}</p>
          </div>
          <YearField
            id="twin-year"
            label={<>Graduating <span className="twin-optional">(optional)</span></>}
            value={yearRaw}
            onCommit={onYear}
            hint={yearHint}
            placeholder="e.g. 2027"
          />
        </div>
      </form>
    </Card>
  );
}

function StudentResults({
  index, meta, minGroup, headingRef, job, recent, onJob, onRecent, focusNext, validation, level, program,
}: StudentProps & { level: Level; program: string }) {
  const k = meta.k ?? DEFAULT_K;
  const [allStops, setAllStops] = useState(false);
  const hero = programHero(index, level, program)!;
  const g = hero.group;
  const recentG = getGroup(index, level, program, RECENT_BAND, '*');
  const useRecent = recent && recentG != null;
  const shownG = useRecent ? recentG : g;
  const who = whoPhrase(level, program);
  const range = cohortRange(RECENT_BAND)!;
  const classes = useRecent ? `the classes of ${range.from}–${range.to}` : 'the classes of 1995–2024';

  const stopAll = hero.stop;
  const stop = useRecent ? firstStop(shownG) : stopAll;
  const stats = hero.stats;
  const chips = jobChips(index, level, program, stopAll);
  const chip = job !== '*' ? chips.find((c) => c.id === job) : undefined;
  const pathG = chip?.group ?? g;
  const snapshot = snapshotLabel(meta.snapshot);
  const traj = trajectory(pathG, { maxFields: 4, mode: 'student', snapshot });
  const pStats = pathStats(pathG, chip ? chip.id : '*', 'people', k);
  const river = hasRiver(meta.programs ?? [], level, program);
  const shareTitle = programTitle(level, program, ambiguousNames(meta.programs ?? []).has(program.trim().toLowerCase()));
  const classYear = validation.answers.year;

  const url = shareUrl(window.location.origin, import.meta.env.BASE_URL, {
    mode: 'student', level, program, year: classYear, job: chip ? chip.id : '*', recent: useRecent,
  });
  const alumHref = `/twin${twinQuery({ mode: 'alum', level, program, year: classYear })}`;

  // First stops: destinations largest first, then the rows that aren't destinations.
  const main = stop?.rows.filter((r) => !r.muted) ?? [];
  const muted = stop?.rows.filter((r) => r.muted) ?? [];
  const collapsible = main.length >= TOP_STOPS + MIN_HIDDEN;
  const rows = [...(allStops || !collapsible ? main : main.slice(0, TOP_STOPS)), ...muted];
  const bars: BarItem[] = rows.map((r) => ({ key: r.id, label: r.label, n: r.n, of: stop!.n, muted: r.muted }));
  const stopNote = firstStopSticker(stop);
  const employers = shownG.employersFirst;
  const empNote = employerSticker(employers);

  const pathTitle = chip
    ? chip.widened
      ? `${fmtInt(chip.group.n)} ${LEVEL_PEOPLE[level]} who ${startPhrase(chip.id)}`
      : `${fmtInt(chip.group.n)} ${who} who ${startPhrase(chip.id)}`
    : `All ${fmtInt(g.n)} ${who}`;
  const pathNotes: string[] = [];
  if (chip?.widened) {
    pathNotes.push(`Fewer than ${minGroup} ${who} ${startPhrase(chip.id)}, so this follows every ${LEVEL_PEOPLE[level].replace(/s$/, '')} who did, from any program.`);
  }
  if (useRecent) pathNotes.push('Paths use every class from 1995 to 2024: recent classes haven’t been out long enough.');
  if (isSmall(pathG.n)) pathNotes.push(SMALL_NOTE);

  return (
    <div className="twin-results">
      <Card as="article" variant="ink" pad="lg" className="twin-hero" aria-labelledby="twin-hero-h">
        <p className="eyebrow twin-hero__eyebrow">{LEVEL[level].label} · Classes of 1995–2024</p>
        <h2 id="twin-hero-h" className="twin-hero__title" ref={headingRef} tabIndex={-1}>
          <span className="num">{fmtInt(g.n)}</span> {who}
        </h2>
        <p className="twin-hero__desc">Where they went after Queen’s, from their first job to today, as their public LinkedIn profiles tell it.</p>
        {stats.length > 0 && (
          <ul className={`twin-stats twin-stats--n${stats.length}`} aria-label="Headline numbers">
            {stats.map((s, i) => (
              <StatBlock key={s.id} as="li" size="md" value={s.value} label={s.text} detail={s.detail} highlight={i === 0} className="twin-stat" />
            ))}
          </ul>
        )}
        <p className="twin-hero__privacy">
          A group, not a person: {fmtInt(g.n)} real grads whose careers are added up. {SITE.privacyLine}
          {isSmall(g.n) && <> <strong className="twin-small">{SMALL_NOTE}</strong></>}
        </p>
      </Card>

      <div className="twin-toolbar">
        <ShareProgram level={level} program={program} title={shareTitle} />
        <CopyLink url={url} ariaLabel="Copy link to this view" align="start" />
        {river && (
          <p className="twin-toolbar__river">
            <Link to={riverHref({ level, program })}>Follow {program} in the River <span aria-hidden="true">→</span></Link>
          </p>
        )}
      </div>

      <div className="twin-grid twin-grid--student">
        <Card as="section" className="twin-sec twin-sec--stop" aria-labelledby="twin-stop-h">
          {stopNote && <Sticker className="twin-sticker" tilt={4}>{stopNote}</Sticker>}
          <div className="twin-sec__head">
            <div>
              <h3 id="twin-stop-h">Their first stop after Queen’s</h3>
              <p className="twin-sec__sub">
                First job, or more school, as a share of {stop ? people(stop.n, 'grads') : 'the grads'} from {classes}.
              </p>
            </div>
            {recentG && (
              <Toggle label="Recent classes only" checked={useRecent} onChange={onRecent} title={`Only the classes of ${range.from}–${range.to}`} />
            )}
          </div>
          {stop ? (
            <>
              <ShareBars id="twin-stop-bars" items={bars} caption={`First stop after Queen’s, ${who}, ${classes}`} />
              {collapsible && (
                <div className="twin-more">
                  <Toggle
                    label={`Show all ${main.length} first stops`}
                    checked={allStops}
                    onChange={setAllStops}
                    controls="twin-stop-bars"
                  />
                </div>
              )}
              {muted.some((r) => r.id === 'no_role_listed') && (
                <p className="twin-notes">No role listed: nothing on their profile for the months after graduating.</p>
              )}
            </>
          ) : (
            <p className="twin-muted">No first stop had {k.field} or more of them.</p>
          )}
        </Card>

        <Card as="section" className="twin-sec twin-sec--emp" aria-labelledby="twin-emp-h">
          {employers.length > 0 && empNote && <Sticker className="twin-sticker" tone="lilac" tilt={-5}>{empNote}</Sticker>}
          <h3 id="twin-emp-h">Most common first employers</h3>
          <p className="twin-sec__sub">Share of all {people(shownG.n, 'grads')} from {classes} whose first job was there.</p>
          {employers.length > 0 ? (
            <ul className="twin-emp" aria-labelledby="twin-emp-h">
              {employers.map((e, i) => (
                <li key={`${e.name}-${i}`} className="twin-emp__chip">
                  <span className="twin-emp__name">{e.name}</span>
                  <span className="twin-emp__pct num">{percent(e.n, shownG.n)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="twin-muted">No single employer was the first job of {k.named} or more of them.</p>
          )}
        </Card>

        <Card as="aside" variant="lime" className="twin-cta" aria-labelledby="twin-cta-h">
          <h3 id="twin-cta-h">Already graduated?</h3>
          <p>Four questions (degree, program, class and first job) find the {minGroup} or more alumni who started exactly where you did.</p>
          <LinkButton to={alumHref} variant="primary" onClick={() => focusNext('next-question')}>
            Find your exact twins <span aria-hidden="true">→</span>
          </LinkButton>
        </Card>

        <Card as="section" className="twin-sec twin-sec--wide twin-path" aria-labelledby="twin-path-h">
          <h3 id="twin-path-h">Pick a first job, see where it leads</h3>
          <p className="twin-sec__sub">Follow the grads who started in each field, from their first job to today.</p>
          <ChoiceChips
            legend="First job"
            hideLegend
            className="twin-path__chips"
            value={chip ? chip.id : '*'}
            onChange={onJob}
            options={[{ id: '*' as First, label: 'All of them' }, ...chips.map((c) => ({ id: c.id as First, label: c.label, dot: c.id }))]}
          />
          <div className="twin-path__body">
            <h4 className="twin-path__title">{pathTitle}</h4>
            {pathNotes.length > 0 && <ul className="twin-path__notes">{pathNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {traj ? (
              <TrajectoryChart
                key={`${pathG.level}|${pathG.program}|${pathG.s0}`}
                data={traj}
                label={`Where ${pathTitle.replace(/^All /, 'all ')} were, year by year`}
                height={250}
                classYear={classYear != null && classYear > YEAR_MAX ? classYear : null}
                k={k.field}
              />
            ) : <p className="twin-muted">Not enough of them to chart.</p>}
            {pStats.length > 0 && (
              <ul className="twin-path__stats" aria-label="Where it led">
                {pStats.map((s) => <StatBlock key={s.id} as="li" size="md" value={s.value} label={s.text} detail={s.detail} />)}
              </ul>
            )}
            {traj && <ul className="twin-notes">{trajectoryNotes(traj, k).map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        </Card>
      </div>

      <div className="twin-foot">
        <p>
          Numbers are approximate: every count is nudged slightly to protect privacy. {hiddenLine(k)}{' '}
          <Link to="/method">How this was made <span aria-hidden="true">→</span></Link>
        </p>
      </div>
    </div>
  );
}
