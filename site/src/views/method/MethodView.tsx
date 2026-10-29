import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ErrorState, Loading } from '../../components/Status';
import { Card, SectionHeading, StatBlock } from '../../components/ui';
import { useData } from '../../data/load';
import { FAMILIES } from '../../data/taxonomy';
import type { InsightsFile, Meta } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { Link } from '../../lib/router';
import { SITE } from '../../site.config';
import {
  Base36Demo, ClassReach, EvidenceTimeline, FoldIllustration, LabelExample, NoiseExample, NoiseOdds, PresentChart,
  PresentExample, ProfileAnatomy, SeniorityLadder, SnowflakeDemo, TaxonomyChips, YearRuler,
} from './figures';
import {
  MIN_SIZES, SECTIONS, TWIN_YEARS, costPerThousand, floorsOf, fmtDay, fmtMonth, fmtUsd, labellingStats, parseUtc,
} from './model';
import type { SectionId } from './model';
import './method.css';

const DATA_FILES = ['meta', 'insights', 'river', 'diaspora', 'twin'] as const;
const dataUrl = (f: string) => `${import.meta.env.BASE_URL}data/${f}.json`;

export default function MethodView() {
  const meta = useData('meta');
  const insights = useData('insights');

  if (meta.status === 'error') return <div className="container"><ErrorState error={meta.error} retry={meta.retry} /></div>;
  if (insights.status === 'error') return <div className="container"><ErrorState error={insights.error} retry={insights.retry} /></div>;
  if (meta.status === 'loading' || insights.status === 'loading') return <Loading label="Loading the method…" />;

  return <Method meta={meta.data} insights={insights.data} />;
}

/** Highlights the section being read. No IntersectionObserver (old browsers, jsdom): no highlight. */
function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = ids.find((id) => seen.get(id));
      if (first) setActive(first);
    }, { rootMargin: '-80px 0px -55% 0px' });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return active;
}

const SECTION_IDS = SECTIONS.map((s) => s.id);

function Method({ meta, insights }: { meta: Meta; insights: InsightsFile }) {
  const active = useActiveSection(SECTION_IDS);
  const c = meta.counts;
  const k = floorsOf(meta.k);
  const snap = insights.snapshot;
  const asOf = parseUtc(snap?.asOf);
  const { stats, total } = labellingStats(insights.labelling);
  const classified = stats.filter((s) => s.id === 'titles' || s.id === 'employers').reduce((a, s) => a + s.value, 0);
  const lab = insights.labelling;
  const top = snap?.currentRolesImplying?.length
    ? [...snap.currentRolesImplying].sort((a, b) => b.pct - a.pct)[0] : null;
  const snapshotMonth = fmtMonth(meta.snapshot, true);
  const jobFamilies = FAMILIES.filter((f) => f.isJob).length;
  const email = SITE.contactEmail.trim();
  const author = SITE.author.name.trim();

  return (
    <div className="method">
      <header className="method-hero container">
        <SectionHeading level={1} eyebrow="Method" title="How Atlas was made" className="method-hero__heading">
          <p>Where the data comes from, how it was read, how no one can be picked out, and where the numbers bend.</p>
        </SectionHeading>
        <ul className="keyfacts" role="list">
          <StatBlock as="li" size="md" value={fmtDay(asOf, true)} label="snapshot date" detail="Every “today” on the site" />
          <StatBlock as="li" size="md" value={fmtInt(c.profiles)} label="public profiles" detail={`${fmtInt(c.alumni)} of them Queen’s alumni`} />
          <StatBlock as="li" size="md" value={fmtInt(classified)} label="titles and employers labelled" detail={lab?.model ? `By ${lab.model}` : undefined} />
          <StatBlock
            as="li" size="md" highlight value={`${k.field} / ${k.named}`} label="smallest group shown"
            detail={`${k.named} when it names an employer, job or place`}
          />
        </ul>
      </header>

      <div className="container method-body">
        <nav className="toc" aria-label="On this page">
          <p className="toc__title">On this page</p>
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="toc__link" aria-current={active === s.id ? 'location' : undefined}>
                  <span className="toc__n num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="prose">
          <Section id="data" n={1}>
            <Card as="div" className="source">
              <p className="source__label">Where the data comes from</p>
              <p className="source__text">
                A third-party dataset of public LinkedIn profiles of people who list Queen’s University, compiled by a
                commercial data provider in {snapshotMonth}. I didn’t scrape LinkedIn myself and don’t redistribute the raw
                data, and nothing on this site identifies an individual: small groups are hidden and every number is lightly
                perturbed.
              </p>
              {email && (
                <p className="source__optout">
                  Want your profile excluded? Email <a href={`mailto:${email}`}>{email}</a>.
                </p>
              )}
            </Card>
            <p className="prose__lead">
              The file holds <strong>{fmtInt(c.profiles)} profiles</strong>. <strong>{fmtInt(c.alumni)}</strong> of them have an
              education entry at Queen’s (Smith School of Business included): they are the alumni counted on this site. Together
              they list <strong>{fmtInt(c.roles)} roles</strong> once LinkedIn’s grouped positions are flattened.
            </p>
            <p>
              I streamed the file one profile at a time into a few tables (people, education, positions, activity), so it never
              had to fit in memory. Here is what a profile holds, and what each part is used for:
            </p>
            <ProfileAnatomy />
            <p>
              About 83% of Queen’s education entries carry an end year, which is what puts someone in a graduating class. The
              River and Career Twin use {fmtInt(c.paths)} career paths: one per Queen’s credential from the classes
              of {c.firstYear}–{c.lastYear} with a usable job history. The Diaspora uses every alumnus with a known location.
            </p>
          </Section>

          <Section id="dating" n={2}>
            <p className="prose__lead">
              The file came without a date. That matters: “today” in the River, and every “years since graduating”, depend on
              when the pages were read. So I went looking for clues, and found three that don’t depend on each other.
            </p>
            <h3>Clue 1: LinkedIn’s own arithmetic</h3>
            <p>
              A current role reads like “Jan 2025 – Present · 9 mos”. LinkedIn counts months inclusively, so start plus duration
              minus one is the month the page was viewed:
            </p>
            <PresentExample />
            {top && (
              <p>
                Over every current role in the file, <strong>{top.pct.toFixed(0)}%</strong> point to {fmtMonth(top.month, true)}.
                Most of the rest point to the month before (pages cached a little earlier).
              </p>
            )}
            <PresentChart rows={snap?.currentRolesImplying ?? []} sample={snap?.currentRolesSample} />
            <h3>Clue 2: timestamps hidden in IDs</h3>
            <p>
              Posts and reactions carry numeric IDs. LinkedIn’s IDs are “snowflakes”: shift one right by 22 bits and what’s left
              is the moment it was created, in milliseconds since 1970. The newest activity in the file gives a lower bound for
              when the snapshot was taken.
            </p>
            {snap?.newestActivity && <SnowflakeDemo newest={snap.newestActivity} />}
            <h3>Clue 3: the export’s file name</h3>
            <p>
              The companion export file is named with a short base-36 string. Read as a number, it’s another millisecond
              timestamp, written just after the newest activity.
            </p>
            {snap?.exportFileTimestamp && <Base36Demo exportTs={snap.exportFileTimestamp} />}
            {snap && <EvidenceTimeline snapshot={snap} />}
          </Section>

          <Section id="labels" n={3}>
            <p className="prose__lead">
              People write job titles however they like: “Sr. SWE II”, “Associate”, “Analyste principal”. To compare careers,
              every title, employer, field of study and place has to be read and put in a box. I asked a model to do the reading.
            </p>
            {stats.length > 0 && (
              <ul className="stat-grid" role="list">
                {stats.map((s) => <StatBlock key={s.id} as="li" size="md" value={fmtInt(s.value)} label={s.label} />)}
              </ul>
            )}
            {lab && (
              <p>
                {lab.model} labelled each <em>distinct</em> string once, through the Message Batches API with a JSON schema for
                every answer, and the labels were joined back onto every role that uses them. The whole run cost
                <strong> {fmtUsd(lab.costUsd)}</strong>: about {costPerThousand(lab.costUsd, total)} per thousand strings.
              </p>
            )}
            <LabelExample />
            <h3>A taxonomy built for careers</h3>
            <p>
              Each title gets one of 28 job functions and a seniority. Functions roll up into {jobFamilies} career families, and
              families into eight colour sectors, so a chart never needs more colours than the eye can tell apart.
            </p>
            <TaxonomyChips />
            <SeniorityLadder />
            <h3>Rules after the model</h3>
            <p>A model is good at reading; rules are better at consistency. After labelling, plain code applies:</p>
            <ul className="rules">
              <li><strong>Ambiguous titles take the employer’s industry.</strong> An “Associate” at a bank is finance, at a law
                firm it’s law; at an unlabelled employer, a law-degree holder’s ambiguous title counts as legal.</li>
              <li><strong>Small employers get an industry from their name</strong> when it’s unambiguous: law firms, school
                boards, hospitals, universities, banks.</li>
              <li><strong>Side roles never count as jobs.</strong> Boards, volunteering, clubs and student societies are flagged
                and skipped.</li>
              <li><strong>Programs are merged and levelled.</strong> Degree level is parsed from the degree string. Undergraduate
                business variants (Business, Finance, Marketing, …) collapse into <em>Commerce</em>; MBA, JD and MD name their
                own program. The same name at two levels stays two programs: Computer Science (undergrad) is not Computer Science
                (master’s/PhD).</li>
              <li><strong>Employers roll up to their parent</strong>, so RBC Capital Markets and RBC Royal Bank are both RBC.</li>
            </ul>
          </Section>

          <Section id="careers" n={4}>
            <p className="prose__lead">
              A profile is a list of jobs. To compare {fmtInt(c.paths)} careers, every path is read at the same points, counted
              from the year the person graduated: the first job, then every June for twenty years, then today.
            </p>
            <YearRuler snapshotLabel={snapshotMonth} />
            <dl className="defs">
              <div>
                <dt>First job (year 0)</dt>
                <dd>The first real job after graduating, within three years. Further study if another degree came first.</dd>
              </div>
              <div>
                <dt>Year 1 to year 20</dt>
                <dd>
                  The main job held in June of that year (the most recently started one if several overlap). Else further study
                  if another degree was under way. Else “no role listed”.
                </dd>
              </div>
              <div>
                <dt>Today</dt>
                <dd>The main job at the snapshot, {snapshotMonth}.</dd>
              </div>
            </dl>
            <p>
              A year is blank, not “no role listed”, when its June falls after the snapshot: a 2018 grad has years 1 to 7.
            </p>
            <h3>Five-year classes</h3>
            <p>
              The River and Career Twin group grads into five-year classes, {classSpan(meta)}, plus all of them together. The
              River draws a column for each of years 3, 5, 10 and 20 that <em>every</em> member of the class has reached:
            </p>
            <ClassReach cohorts={meta.cohorts} snapshot={meta.snapshot} />
            <p>
              Its year-by-year chart goes further. Each year is counted over the members who have reached it, and its shares
              are of that year’s own total, so year 8 of the 2015–2019 class is the classes of 2015–2017 only. A year is shown
              once at least {MIN_SIZES.yearPoint} members have reached it. Career Twin keeps years {TWIN_YEARS.join(', ')} and
              today, with the same numbers as the River for the same people.
            </p>
            <p>
              Two states sit alongside the job families. <strong>Further study</strong> means another program (law school,
              medicine, a master’s) was under way. <strong>No role listed</strong> means the profile shows nothing for that
              moment, which is not the same as unemployed.
            </p>
            <h3>Why the River starts in {c.firstYear}</h3>
            <p>
              Older profiles thin out at the start. People trim early jobs, or joined LinkedIn decades into their careers: more
              than 40% of pre-1990 grads list no first job, against 6–9% for the classes of 2005–2024. Rather than draw a river
              that is mostly gaps, the career views start with the class of {c.firstYear}. The Diaspora, which only needs where
              someone lives now, includes earlier classes too.
            </p>
          </Section>

          <Section id="privacy" n={5}>
            <p className="prose__lead">
              Every profile belongs to a real person who never asked to be in a data project. So the site shows groups, never
              people, and the rules run in the pipeline before anything is published.
            </p>
            <div className="floors">
              <Card variant="ink" className="floor">
                <span className="floor__k num">{k.field}+</span>
                <p>
                  <strong>people for any count by career field.</strong> How many went into tech, moved on, live abroad.
                  Groups under {k.field} are hidden.
                </p>
              </Card>
              <Card variant="ink" className="floor">
                <span className="floor__k num">{k.named}+</span>
                <p>
                  <strong>people for anything that names an employer, a job title or a place.</strong> Employer and title
                  lists, every city and country on the map. Groups under {k.named} are hidden.
                </p>
              </Card>
            </div>
            <p className="privacy-line">{SITE.privacyLine}</p>
            <FoldIllustration k={k.field} />
            <ul className="rules">
              <li><strong>Hiding small groups.</strong> Career fields under {k.field} at a River column or a year fold into
                “Smaller groups”; River flows under {k.field} are dropped, and their total is shown only once it reaches {k.field}.
                An employer, a job title, a city or a country is named only when at least {k.named} people share it.</li>
              <li><strong>Nudging every count.</strong> Each published count is moved by between −2 and +2 (explained below).</li>
              <li><strong>Minimum sizes.</strong> A River class needs {MIN_SIZES.riverClass} people, a Career Twin
                group {MIN_SIZES.twinGroup}, a Diaspora filter {MIN_SIZES.diasporaFilter}, a point on a year-by-year
                chart {MIN_SIZES.yearPoint} members, and a program {MIN_SIZES.leaderboard} grads to enter a leaderboard. These
                keep the charts meaningful; the floors above are what protect people.</li>
              <li><strong>Groups, not people.</strong> No names, photos, profile links, quotes or job histories are published.
                Career Twin matches you to a group of at least {MIN_SIZES.twinGroup}, never to a person.</li>
              <li><strong>The raw data stays on my laptop.</strong> The raw file and every per-person table stay on one machine,
                outside version control. Only the aggregates ship.</li>
              <li>
                <strong>You can check.</strong> Everything this site knows is in five static files:{' '}
                {DATA_FILES.map((f, i) => (
                  <span key={f}>
                    <a href={dataUrl(f)}>{f}.json</a>{i < DATA_FILES.length - 1 ? ', ' : '.'}
                  </span>
                ))}
              </li>
            </ul>
            <h3 id="noise">Why numbers don’t add up exactly</h3>
            <p>
              Hiding small groups isn’t enough on its own. If every published count were exact, two of them could be
              subtracted to uncover a group that was never published: all the grads of a program living in one city, minus the
              same group without its newest class, leaves just the newest class, however few they are. Statisticians call this
              a <em>differencing attack</em>.
            </p>
            <p>
              So every count is nudged by between −2 and +2 before it’s published. The nudge isn’t rolled fresh each time: it’s
              worked out from who is inside the count, so the same set of people always gets the same nudge, in every file.
              Asking the same question many times and averaging gets you nowhere. This is <strong>cell-key
              perturbation</strong>, the method the Australian Bureau of Statistics uses for its census tables.
            </p>
            <NoiseOdds />
            <NoiseExample />
            <p>
              The price is small and visible: a River column may not add up exactly to the class total, a percentage can differ
              slightly from one computed on the raw data, and two views of the same group may differ by a person or two. That
              is deliberate. The noise matters least where the numbers are large, and most findings here rest on hundreds of
              people or more.
            </p>
          </Section>

          <Section id="limits" n={6}>
            <p className="prose__lead">
              This is a careful reading of an imperfect source. Before quoting a number, know where it bends.
            </p>
            <div className="limits">
              <Limit title="Not career advice" variant="lime">
                It shows what happened to past grads, from self-reported profiles. It isn’t a prediction, and it isn’t career
                advice.
              </Limit>
              <Limit title="LinkedIn is self-selected">
                Who keeps a public, current profile isn’t random. Business, tech and consulting careers are likely
                over-represented; trades, the arts, and people who stepped away from paid work are likely under-represented.
              </Limit>
              <Limit title="Older careers start sparse">
                Grads from the 1990s often list little before their current job, so their early years are thinner and lean
                toward the roles people chose to keep.
              </Limit>
              <Limit title="Labels can be wrong">
                One model pass read {fmtInt(total)} strings. The rules handle the known systematic cases, but a single title can
                still land in the wrong family, especially vague ones like “Associate”.
              </Limit>
              <Limit title="“No role listed” isn’t unemployed">
                It means the profile is silent for that moment: parental leave, caregiving, retirement, a stale profile, or a
                job someone didn’t add.
              </Limit>
              <Limit title="Geography is Canada-centric">
                Places were geocoded by the same model, with metro areas built around Canadian cities. Abroad, some people can
                only be placed at country level, and small foreign cities fall under the {k.named}-person floor.
              </Limit>
              <Limit title="A snapshot, not a census">
                One moment in {snapshotMonth}, of the profiles that were captured. Percentages describe these profiles, not every
                Queen’s graduate, and they will drift as careers move on.
              </Limit>
            </div>
          </Section>

          <Section id="stack" n={7}>
            <dl className="stack">
              {author && (
                <div>
                  <dt>Made by</dt>
                  <dd className="stack__author">
                    {SITE.author.url ? <a href={SITE.author.url}>{author}</a> : author}
                    {SITE.author.x && <> · <a href={`https://x.com/${SITE.author.x}`}>@{SITE.author.x}</a></>}
                    {SITE.author.github && <> · <a href={SITE.author.github}>GitHub</a></>}
                    , a Queen’s student. A student project, not an official one.
                  </dd>
                </div>
              )}
              <div><dt>Built with</dt><dd>Python and DuckDB for the pipeline; React and D3 for the site, built with Vite. No server and no database: the browser reads the five files above.</dd></div>
              <div><dt>Labels</dt><dd>Job titles labelled with {lab?.model ?? 'Claude'} through the Anthropic Message Batches API{lab ? `, ${fmtUsd(lab.costUsd)} in total` : ''}.</dd></div>
              <div><dt>Privacy</dt><dd>Statistical disclosure control: cell-key perturbation (as used by the Australian Bureau of Statistics), with groups under {k.field} hidden, or under {k.named} when they name an employer, a job title or a place.</dd></div>
              <div><dt>Type and maps</dt><dd>Bricolage Grotesque (SIL Open Font License). Country shapes from Natural Earth via world-atlas.</dd></div>
              <div><dt>Independence</dt><dd>Not affiliated with or endorsed by Queen’s University or LinkedIn. “Queen’s” is used only to say whose careers these are.</dd></div>
              {email && <div><dt>Contact</dt><dd>Questions, corrections, or a profile to exclude: <a href={`mailto:${email}`}>{email}</a>.</dd></div>}
            </dl>
            <p className="method-end">
              Seen something that looks wrong? Start with the <Link to="/river">River</Link>,
              the <Link to="/diaspora">Diaspora</Link> or your <Link to="/twin">Career Twin</Link>, and check any number against
              the files above.
            </p>
          </Section>
        </article>
      </div>
    </div>
  );
}

/** "1995–1999 to 2020–2024", from meta.cohorts; falls back to the counts' first and last year. */
function classSpan(meta: Meta): string {
  const bands = (meta.cohorts ?? []).filter((c) => c.id !== 'all').sort((a, b) => a.from - b.from);
  if (bands.length >= 2) {
    const a = bands[0];
    const b = bands[bands.length - 1];
    return `${a.from}–${a.to} to ${b.from}–${b.to}`;
  }
  return `${meta.counts.firstYear} to ${meta.counts.lastYear}`;
}

function Section({ id, n, children }: { id: SectionId; n: number; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)?.title ?? id;
  return (
    <section id={id} className="m-section" aria-labelledby={`${id}-title`}>
      <p className="m-section__n num" aria-hidden="true">{String(n).padStart(2, '0')}</p>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}

function Limit({ title, children, variant = 'plain' }: { title: string; children: ReactNode; variant?: 'plain' | 'lime' }) {
  return (
    <Card variant={variant} pad="sm" flat={variant === 'plain'} className="limit">
      <h3>{title}</h3>
      <p>{children}</p>
    </Card>
  );
}
