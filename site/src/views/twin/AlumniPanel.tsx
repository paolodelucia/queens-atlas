/**
 * Alumni view: four questions (degree, program, graduation year, first job), each written to the
 * URL as it's answered, then the most specific group of alumni who started the same way. An exact
 * match is "your career twins"; a widened one is "alumni close to your start", never twins, with
 * a badge that names what was let go.
 */
import type { FormEvent, ReactNode } from 'react';
import { CopyLink, ProgramPicker, Segmented } from '../../components/controls';
import type { PickerOption } from '../../components/controls';
import { Button, Card, Highlight, StatBlock, Sticker } from '../../components/ui';
import { Empty } from '../../components/Status';
import { fmtInt } from '../../lib/format';
import { Link } from '../../lib/router';
import { SITE } from '../../site.config';
import { ManagerChart, ManagerTable, RankList, SeniorityBars, TrajectoryChart } from './charts';
import { ChoiceChips, LEVEL_FIELD_CLASS, LEVEL_OPTIONS, YearField } from './fields';
import {
  DEFAULT_K, EXAMPLES, FIRST_OPTIONS, SMALL_NOTE, YEAR_MAX, YEAR_MIN, cohortRange, employerSticker, findTwins, headlineStats,
  hiddenLine, isSmall, listWords, managerPoints, matchCopy, nounFor, oneInN, pairSections, people, percent, queryFromAnswers,
  riverLink, seniorityRows, shareUrl, snapshotLabel, staySticker, trajectory, trajectoryNotes,
} from './model';
import type { Answers, First, TwinMatch } from './model';
import type { PanelProps } from './panel';

interface AlumniProps extends PanelProps {
  onFirst: (f: First) => void;
  onReset: () => void;
  onExample: (e: (typeof EXAMPLES)[number]) => void;
}

export function AlumniPanel(props: AlumniProps) {
  const { validation: v, index, minGroup, programsFor, onExample } = props;
  const match = v.complete ? findTwins(index, queryFromAnswers(v.answers)) : null;
  const announce = match ? `${matchCopy(match, minGroup).sentence} Results are below.` : '';
  const examples = EXAMPLES.filter((e) => programsFor(e.level).some((o) => o.program === e.program));

  return (
    <>
      <AlumniForm {...props} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>
      <div className="twin-anchor">
        {match ? (
          <AlumniResults {...props} match={match} />
        ) : v.complete ? (
          <Empty>No group fits those answers. Try changing one of them.</Empty>
        ) : (
          <Card as="section" className="twin-empty" aria-labelledby="twin-empty-h">
            <div className="twin-empty__progress" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <span key={i} className={i < v.answered ? 'is-on' : ''} />)}
            </div>
            <h2 id="twin-empty-h" className="twin-empty__title">
              {v.answered === 0 ? 'Four quick questions, then meet your twins' : `${4 - v.answered} more to go`}
            </h2>
            <p className="twin-empty__lede">
              Your twins are {minGroup} or more Queen’s alumni who started out the way you did: same degree, program, class and first
              job. You’ll see where they were year by year, and where they are today. Or try one of these:
            </p>
            <ul className="twin-examples">
              {examples.map((e) => (
                <li key={e.label}>
                  <button type="button" className="twin-example" onClick={() => onExample(e)}>
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

function AlumniForm({ validation: v, programs, yearRaw, formRef, onLevel, onProgram, onYear, onFirst }: AlumniProps) {
  const { level, program, year, cohort, first } = v.answers;
  const single = level != null && programs.length === 1;
  const options: PickerOption[] = programs.map((o) => ({ value: o.program, label: o.program, n: o.n }));
  const programHint = level == null ? 'Programs depend on the degree.'
    : single ? 'The only program at this level.' : `${programs.length} programs, largest first.`;
  const range = cohortRange(cohort ?? '*');
  const yearHint = range
    ? `You’re in the class of ${range.from}–${range.to} group.`
    : year != null
      ? `${year} is outside the classes covered, so every class counts.`
      : `Any year from ${YEAR_MIN} to ${YEAR_MAX}. Classes are grouped in fives.`;

  return (
    <Card as="section" className="twin-form" aria-labelledby="twin-form-h">
      <h2 id="twin-form-h" className="twin-form__h">Where did you start?</h2>
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
          <YearField id="twin-year" label="Graduation year" value={yearRaw} onCommit={onYear} hint={yearHint} />
        </div>
        <ChoiceChips
          legend="First job after Queen’s"
          className="twin-first"
          value={first}
          onChange={onFirst}
          options={FIRST_OPTIONS.map((o) => ({ id: o.id, label: o.label, dot: o.id === '*' ? undefined : o.id, muted: o.id === '*' }))}
        />
      </form>
    </Card>
  );
}

/** A results card. `sticker` is a margin note slapped on its top edge. */
interface SectionSpec { id: string; title: string; sub?: ReactNode; body: ReactNode; wide?: boolean; sticker?: ReactNode }

function AlumniResults({ match, meta, minGroup, headingRef, validation, onReset }: AlumniProps & { match: TwinMatch }) {
  const answers: Answers = validation.answers;
  const k = meta.k ?? DEFAULT_K;
  const g = match.group;
  const copy = matchCopy(match, minGroup);
  const noun = nounFor(match);
  const stats = headlineStats(g, noun);
  const snapshot = snapshotLabel(meta.snapshot);
  const traj = trajectory(g, { maxFields: 5, mode: 'alum', snapshot });
  const seniority = seniorityRows(g);
  const mgr = managerPoints(g);
  const mgrShown = mgr.filter((p) => p.n != null);
  const mgrHidden = mgr.filter((p) => p.n == null);
  const url = shareUrl(window.location.origin, import.meta.env.BASE_URL, { mode: 'alum', ...answers });
  const river = riverLink(meta.programs ?? [], answers);
  const employerMax = Math.max(1, ...g.employersFirst.map((e) => e.n), ...g.employersNow.map((e) => e.n));
  const stay = staySticker(g);
  const empNote = employerSticker(g.employersFirst);

  const sections: SectionSpec[] = [];
  if (traj) {
    sections.push({
      id: 'twin-where', wide: true, title: 'Where they worked, year by year',
      sub: `Share of ${noun === 'twins' ? 'your twins' : 'these alumni'} in each field, from their first job to today.`,
      sticker: stay && <Sticker className="twin-sticker" tilt={-4}>{stay}</Sticker>,
      body: (
        <>
          <TrajectoryChart data={traj} label="Where they worked, year by year" noun={noun} height={300} k={k.field} />
          <ul className="twin-notes">{trajectoryNotes(traj, k).map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      ),
    });
  }
  if (seniority.length > 0) {
    sections.push({
      id: 'twin-senior', title: 'How senior they are today',
      sub: <>Seniority of their current title, as a share of all {people(g.n, noun)}. No role listed, or a title that couldn’t be placed: not shown.</>,
      body: (
        <>
          <SeniorityBars rows={seniority} total={g.n} noun={noun} />
          <p className="twin-notes">Titles are self-reported; banks and consultancies use ‘VP’ and ‘Director’ for mid-career roles.</p>
        </>
      ),
    });
  }
  if (mgrShown.length >= 3) {
    sections.push({
      id: 'twin-mgr', title: 'How fast they became managers',
      sub: `Share who had held a manager title or above, by years after graduating. Each point counts only ${noun} who have been out that long.`,
      body: (
        <>
          <ManagerChart points={mgr} noun={noun} />
          {mgrHidden.length > 0 && (
            <p className="twin-notes">
              Not plotted: year{mgrHidden.length > 1 ? 's' : ''} {listWords(mgrHidden.map((p) => String(p.years)))}, where fewer than {k.field} {noun} had
              held a manager title.
            </p>
          )}
          <details className="twin-details">
            <summary>Show as a table</summary>
            <ManagerTable points={mgr} noun={noun} k={k.field} />
          </details>
        </>
      ),
    });
  } else if (mgrShown.length > 0) {
    sections.push({
      id: 'twin-mgr', title: 'How fast they became managers',
      sub: `Share who had held a manager title or above, counting only ${noun} who have been out that long.`,
      body: (
        <ul className="twin-mgr-list">
          {[...mgrShown].reverse().map((p) => (
            <li key={p.years}>
              <strong>{percent(p.n, p.of)}</strong> within {p.years === 1 ? 'a year' : `${p.years} years`}{' '}
              <span className="twin-muted num">({fmtInt(p.n!)} of {people(p.of, noun)})</span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  const firstList = g.employersFirst.length > 0;
  const nowList = g.employersNow.length > 0;
  if (firstList || nowList) {
    const both = firstList && nowList;
    sections.push({
      id: 'twin-emp', wide: both,
      title: both ? 'First employers, and where they work now' : firstList ? 'Most common first employers' : 'Most common employers today',
      sub: `${both ? 'Most common employers, as a' : 'As a'} share of all ${people(g.n, noun)}. Employers with fewer than ${k.named} of them aren’t named.`,
      sticker: firstList && empNote && <Sticker className="twin-sticker" tone="lilac" tilt={5}>{empNote}</Sticker>,
      body: both ? (
        <div className="twin-pair">
          <div>
            <h4 className="twin-pair__h">First job</h4>
            <RankList items={g.employersFirst} total={g.n} scaleMax={employerMax} label="Most common first employers" />
          </div>
          <div>
            <h4 className="twin-pair__h">Today</h4>
            <RankList items={g.employersNow} total={g.n} scaleMax={employerMax} label="Most common employers today" />
          </div>
        </div>
      ) : (
        <RankList
          items={firstList ? g.employersFirst : g.employersNow}
          total={g.n}
          label={firstList ? 'Most common first employers' : 'Most common employers today'}
        />
      ),
    });
  }
  if (g.titlesNow.length > 0) {
    sections.push({
      id: 'twin-titles', title: 'Most common job titles today',
      sub: `Share of all ${people(g.n, noun)} holding each title.`,
      body: <RankList items={g.titlesNow} total={g.n} label="Most common job titles today" />,
    });
  }
  if (g.located != null && g.located > 0) {
    const located = g.located;
    sections.push({
      id: 'twin-live', title: 'Where they live now',
      sub: `Of the ${people(located, noun)} whose location is known.`,
      body: (
        <>
          <div className="twin-figs">
            <p className="twin-fig">
              {g.abroad != null
                ? <><strong>{oneInN(g.abroad, located) ?? percent(g.abroad, located)}</strong> live outside Canada <span className="twin-muted num">({fmtInt(g.abroad)})</span></>
                : <><strong>Fewer than {k.field}</strong> live outside Canada</>}
            </p>
            <p className="twin-fig">
              {g.us != null
                ? <><strong>{oneInN(g.us, located) ?? percent(g.us, located)}</strong> live in the US <span className="twin-muted num">({fmtInt(g.us)})</span></>
                : <><strong>Fewer than {k.field}</strong> live in the US</>}
            </p>
          </div>
          {g.topMetros.length > 0 && (
            <>
              <h4 className="twin-pair__h">Top cities</h4>
              <RankList items={g.topMetros} total={located} label={`Cities where the most ${noun} live`} />
            </>
          )}
        </>
      ),
    });
  }
  const wide = pairSections(sections.map((x) => !!x.wide));

  return (
    <div className="twin-results">
      <Card as="article" variant="ink" pad="lg" className={`twin-hero${copy.widened ? ' is-widened' : ''}`} aria-labelledby="twin-hero-h">
        <p className="eyebrow twin-hero__eyebrow">Career Twin · {snapshot} snapshot</p>
        <h2 id="twin-hero-h" className="twin-hero__title" ref={headingRef} tabIndex={-1}>
          {copy.widened
            ? <><span className="num">{fmtInt(g.n)}</span> alumni close to your start</>
            : <>Your <Highlight className="num">{fmtInt(g.n)}</Highlight> career twins</>}
        </h2>
        {copy.badge && <p className="twin-badge">{copy.badge}</p>}
        <p className="twin-hero__desc">{copy.sentence}</p>
        {stats.length > 0 && (
          <ul className={`twin-stats twin-stats--n${stats.length}`} aria-label="Headline numbers">
            {stats.map((s) => (
              <StatBlock key={s.id} as="li" size="md" value={s.value} label={s.text} detail={s.detail} className="twin-stat" />
            ))}
          </ul>
        )}
        <p className="twin-hero__privacy">
          A group, not a person: {copy.widened ? 'these are' : 'your twins are'} {fmtInt(g.n)} real alumni whose careers are added up.{' '}
          {SITE.privacyLine}
          {isSmall(g.n) && <> <strong className="twin-small">{SMALL_NOTE}</strong></>}
        </p>
      </Card>

      <div className="twin-toolbar">
        <CopyLink url={url} ariaLabel="Copy link to these results" align="start" />
        <p className="twin-toolbar__river">
          <Link to={river.href}>{river.label} <span aria-hidden="true">→</span></Link>
          {!river.own && answers.program && <span className="twin-muted"> {answers.program} has no River of its own.</span>}
        </p>
      </div>

      <div className="twin-grid">
        {sections.map((sec, i) => (
          <Card as="section" key={sec.id} className={`twin-sec${wide[i] ? ' twin-sec--wide' : ''}`} aria-labelledby={`${sec.id}-h`}>
            {sec.sticker}
            <h3 id={`${sec.id}-h`}>{sec.title}</h3>
            {sec.sub && <p className="twin-sec__sub">{sec.sub}</p>}
            {sec.body}
          </Card>
        ))}
      </div>

      <div className="twin-foot">
        <div className="twin-foot__text">
          <p>
            <strong>How matching works.</strong> It looks for the most specific group of at least {minGroup} alumni who share your degree,
            program, class (in five-year groups) and first job. If there aren’t enough, it lets go of your class first, then your first
            job, then your program and finally your degree, and says what it let go. <Link to="/method">More on the method <span aria-hidden="true">→</span></Link>
          </p>
          <p>Numbers are approximate: every count is nudged slightly to protect privacy. {hiddenLine(k)}</p>
        </div>
        <Button onClick={onReset}>Start over</Button>
      </div>
    </div>
  );
}
