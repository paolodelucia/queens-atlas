/**
 * Career Twin. Two ways in, one URL:
 *   ?mode=student (default; not written): pick a program, see where its grads went, first job to today.
 *   ?mode=alum: four questions, then the alumni who started the way you did.
 * Shared answers (?level=&program=&year=) carry across modes; each mode keeps its own extras
 * (student: ?job=&recent=1; alum: ?first=). Any view is a shareable link.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { SectionHeading } from '../../components/ui';
import { ErrorState, Loading } from '../../components/Status';
import { useData } from '../../data/load';
import type { Meta, TwinFile } from '../../data/types';
import { useQueryState } from '../../lib/router';
import { AlumniPanel } from './AlumniPanel';
import {
  DEFAULT_MIN_GROUP, FORM_LEVELS, buildIndex, parseJob, parseMode, programOptions, validateAnswers,
} from './model';
import type { Level, Mode, ProgramOption } from './model';
import { ModeSwitch } from './ModeSwitch';
import { reducedMotion } from './panel';
import type { FocusTarget } from './panel';
import { StudentPanel } from './StudentPanel';
import './twin.css';

export default function TwinView() {
  const twin = useData('twin');
  const meta = useData('meta');

  let body;
  if (twin.status === 'error' || meta.status === 'error') {
    const failed = twin.status === 'error' ? twin : meta.status === 'error' ? meta : null;
    body = failed && <ErrorState error={failed.error} retry={() => { if (twin.status === 'error') twin.retry(); if (meta.status === 'error') meta.retry(); }} />;
  } else if (twin.status === 'loading' || meta.status === 'loading') {
    body = <Loading label="Gathering alumni careers…" />;
  } else {
    body = <Twin twin={twin.data} meta={meta.data} />;
  }

  return (
    <div className="container twin">
      <SectionHeading level={1} eyebrow="Career Twin" title="Where can your program take you?" className="twin-head">
        <p>Tell it your program. It shows where the grads before you went, from first job to today.</p>
      </SectionHeading>
      {body}
    </div>
  );
}

function Twin({ twin, meta }: { twin: TwinFile; meta: Meta }) {
  const [modeRaw, setModeRaw] = useQueryState<string>('mode', '');
  const [levelRaw, setLevel] = useQueryState<string>('level', '');
  const [programRaw, setProgram] = useQueryState<string>('program', '');
  const [yearRaw, setYear] = useQueryState<string>('year', '');
  const [firstRaw, setFirst] = useQueryState<string>('first', '');
  const [jobRaw, setJob] = useQueryState<string>('job', '');
  const [recentRaw, setRecent] = useQueryState<string>('recent', '');
  const mode = parseMode(modeRaw, firstRaw !== '');

  const index = useMemo(() => buildIndex(twin.groups), [twin]);
  const programsByLevel = useMemo(
    () => Object.fromEntries(FORM_LEVELS.map((l) => [l.id, programOptions(meta, twin, l.id)])) as Record<Level, ProgramOption[]>,
    [meta, twin],
  );
  const programsFor = useCallback((level: Level) => programsByLevel[level] ?? [], [programsByLevel]);

  const v = validateAnswers({ level: levelRaw, program: programRaw, year: yearRaw, first: firstRaw }, programsFor, mode);
  const job = parseJob(jobRaw);
  const notes = [...v.notes];
  if (mode === 'student' && job == null) notes.push(`“${jobRaw.trim().slice(0, 40)}” isn’t a first job on the list, so it’s been left out.`);

  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  /**
   * Buttons and links that remove themselves (an example chip, Start over, "Already graduated?")
   * hand focus on: to the results heading, to the first Degree option, or to the first question
   * still unanswered. Set by the handler, applied after the commit that renders the target.
   */
  const pendingFocus = useRef<FocusTarget | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth';
    if (target === 'results') {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView?.({ behavior, block: 'start' });
      return;
    }
    const form = formRef.current;
    if (!form) return;
    let el: HTMLElement | null = null;
    if (target === 'next-question') el = firstUnanswered(form);
    el ??= form.querySelector<HTMLInputElement>('.twin-level input[type="radio"]:not(:disabled)');
    el?.focus({ preventScroll: true });
    form.scrollIntoView?.({ behavior, block: 'start' });
  });

  const onMode = (m: Mode) => {
    if (m === mode) return;
    if (m === 'alum') { setModeRaw('alum'); setJob(''); setRecent(''); }
    else { setModeRaw(''); setFirst(''); }
  };
  const onLevel = (level: Level) => {
    setLevel(level);
    const list = programsFor(level);
    if (list.length === 1) setProgram(list[0].program);
    else if (!list.some((o) => o.program === v.answers.program)) setProgram('');
  };
  const focusNext = (t: FocusTarget) => { pendingFocus.current = t; };

  const common = {
    index, meta, twin, validation: v, yearRaw, formRef, headingRef,
    programs: v.answers.level ? programsFor(v.answers.level) : [],
    programsFor,
    minGroup: twin.min_group ?? DEFAULT_MIN_GROUP,
    onLevel, onProgram: setProgram, onYear: setYear, focusNext,
  };

  return (
    <>
      <ModeSwitch mode={mode} onChange={onMode} />

      {notes.length > 0 && (
        <div className="twin-note" role="note">
          <ul>{notes.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}</ul>
        </div>
      )}

      {mode === 'student' ? (
        <StudentPanel
          {...common}
          job={job ?? '*'}
          recent={recentRaw === '1'}
          onJob={(f) => setJob(f === '*' ? '' : f)}
          onRecent={(on) => setRecent(on ? '1' : '')}
          onExample={(level, program) => {
            focusNext('results');
            setLevel(level); setProgram(program); setJob('');
          }}
        />
      ) : (
        <AlumniPanel
          {...common}
          onFirst={(f) => setFirst(f === '*' ? 'any' : f)}
          onReset={() => {
            focusNext('degree');
            setLevel(''); setProgram(''); setYear(''); setFirst('');
          }}
          onExample={(e) => {
            focusNext('results');
            setLevel(e.level); setProgram(e.program); setYear(String(e.year)); setFirst(e.first === '*' ? 'any' : e.first);
          }}
        />
      )}
    </>
  );
}

/** The first alumni question without an answer: Degree, Program, Graduation year, then First job. */
function firstUnanswered(form: HTMLElement): HTMLElement | null {
  const level = form.querySelector<HTMLInputElement>('.twin-level input[type="radio"]:checked');
  if (!level) return form.querySelector<HTMLInputElement>('.twin-level input[type="radio"]:not(:disabled)');
  const program = form.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (program && !program.disabled && !program.value) return program;
  const year = form.querySelector<HTMLInputElement>('input.twin-year');
  if (year && !year.value) return year;
  const firstChecked = form.querySelector<HTMLInputElement>('.twin-first input[type="radio"]:checked');
  if (!firstChecked) return form.querySelector<HTMLInputElement>('.twin-first input[type="radio"]');
  return null;
}
