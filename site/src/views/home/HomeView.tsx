import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ErrorState, Loading } from '../../components/Status';
import { Card, LinkButton, SectionHeading } from '../../components/ui';
import { useData } from '../../data/load';
import type { InsightsFile, Meta } from '../../data/types';
import { fmtInt } from '../../lib/format';
import { Link, useRouter } from '../../lib/router';
import { SITE } from '../../site.config';
import { FactCard } from './FactCard';
import { HeroRiver } from './HeroRiver';
import { Leaderboards } from './Leaderboards';
import {
  LEVEL_GRADS, employerBars, featuredFacts, findChoice, firstEmployerNote, fmtSnapshot, homeHref, ordinal, popularChoices,
  programChoices, programRanks, riverHref, twinHref, usableRankings,
} from './model';
import type { EmployerBar, ProgramChoice } from './model';
import { ProgramSearch } from './ProgramSearch';
import { DiasporaArt, RiverArt, TwinArt } from './ToolArt';
import { programTitle } from '../twin/shareLinks';
import { ShareProgram } from '../twin/ShareProgram';
import './home.css';

/** Leaderboards only rank programs with at least this many grads (pipeline MIN_RANKING). */
const MIN_RANKING_GRADS = 100;
/** A River class needs this many people (river.json meta.min_slice); smaller programs have none. */
const RIVER_MIN_CLASS = 30;
const EMPLOYERS_SHOWN = 8;

export default function HomeView() {
  const meta = useData('meta');
  const insights = useData('insights');

  if (meta.status === 'error') return <div className="container"><ErrorState error={meta.error} retry={meta.retry} /></div>;
  if (insights.status === 'error') return <div className="container"><ErrorState error={insights.error} retry={insights.retry} /></div>;
  if (meta.status === 'loading' || insights.status === 'loading') return <Loading label="Loading Atlas…" />;

  return <Home meta={meta.data} insights={insights.data} />;
}

function Home({ meta, insights }: { meta: Meta; insights: InsightsFile }) {
  const c = meta.counts;
  const snapshotShort = fmtSnapshot(meta.snapshot, 'short');
  const source = `${SITE.name} · public LinkedIn profiles, ${snapshotShort}`;
  const rankings = useMemo(() => usableRankings(insights.rankings), [insights.rankings]);
  const facts = useMemo(() => featuredFacts(insights.facts).featured, [insights.facts]);
  const firstRows = useMemo(() => employerBars(insights.firstEmployers, EMPLOYERS_SHOWN), [insights.firstEmployers]);

  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="container home-hero__inner">
          <SectionHeading
            level={1}
            size="hero"
            id="home-title"
            eyebrow={`${fmtInt(c.alumni)} Queen’s alumni, followed job by job`}
            eyebrowTone="lime"
            title="What are you studying?"
            className="home-hero__heading"
          >
            <p>Pick your program. See where its grads went, from first job to today.</p>
          </SectionHeading>
          <ProgramFinder meta={meta} insights={insights} />
        </div>
      </section>

      <div className="container home-river">
        <HeroRiver />
      </div>

      {facts.length > 0 && (
        <section className="home-section container" aria-labelledby="facts-title">
          <SectionHeading id="facts-title" eyebrow="In the data" title="Some things it found" />
          <div className="facts">
            {facts.map((f, i) => <FactCard key={f.id} fact={f} source={source} highlight={i === 0} tilt={i % 2 ? -5 : 5} />)}
          </div>
        </section>
      )}

      <section className="home-section container" aria-labelledby="tools-title">
        <SectionHeading id="tools-title" eyebrow="Three tools" title="Or start somewhere else" />
        <ul className="tools" role="list">
          <ToolCard
            to="/river" art={<RiverArt />} name="The River" cta="Open the River"
            hook="Pick a program and a class. See where they went, year by year."
          />
          <ToolCard
            to="/diaspora" art={<DiasporaArt />} name="The Diaspora" cta="Open the map"
            hook={`Where alumni live now: ${fmtInt(c.metros)} metro areas in ${fmtInt(c.countries)} countries.`}
          />
          <ToolCard
            to="/twin" art={<TwinArt />} name="Career Twin" cta="Find your twin"
            hook="Tell it your program. It shows what happened to people who started where you are."
          />
        </ul>
      </section>

      {(rankings.length > 0 || firstRows.length > 0) && (
        <section className="home-section container" aria-labelledby="boards-title">
          <SectionHeading id="boards-title" eyebrow="Leaderboards" title="Which programs lead where">
            <p>The programs whose grads most often have each outcome, and the employers most of them start at.</p>
          </SectionHeading>
          <div className={rankings.length > 0 && firstRows.length > 0 ? 'boards-grid' : 'boards-grid boards-grid--one'}>
            {rankings.length > 0 && (
              <Leaderboards rankings={rankings} years={{ from: c.firstYear, to: c.lastYear }} minGrads={MIN_RANKING_GRADS} />
            )}
            {firstRows.length > 0 && (
              <EmployerList
                title="First employers"
                note="Where the classes of 2015–2024 took their first job after graduating."
                unit="grads started here"
                rows={firstRows}
                footnote={firstEmployerNote(insights.facts, firstRows[0])}
              />
            )}
          </div>
        </section>
      )}

      <aside className="container home-about" aria-label="About">
        <Card variant="lilac" className="home-about__card">
          <div>
            <p className="home-about__by">
              <strong>A student project by {SITE.author.name || 'a Queen’s student'}.</strong>
            </p>
            <p className="home-about__line">
              {SITE.privacyLine} Not career advice. <Link to="/method#privacy">How privacy works</Link>
            </p>
          </div>
          <LinkButton to="/method" className="home-about__btn">How it was made</LinkButton>
        </Card>
      </aside>
    </div>
  );
}

/**
 * The search, what happens once a program is picked, and the popular chips. The pick lives in the
 * page's URL (?level=…&program=…, replaced, not pushed), so Back from the River lands on it again.
 */
function ProgramFinder({ meta, insights }: { meta: Meta; insights: InsightsFile }) {
  const { loc, navigate } = useRouter();
  const choices = useMemo(() => programChoices(meta.programs), [meta.programs]);
  const popular = useMemo(() => popularChoices(choices), [choices]);
  const params = new URLSearchParams(loc.search);
  const chosen = findChoice(choices, params.get('level'), params.get('program'));
  const choose = (choice: ProgramChoice) => navigate(homeHref(choice), { replace: true });
  const hintId = useId();

  if (choices.length === 0) {
    return (
      <div className="finder finder--empty">
        <LinkButton to="/river" variant="primary" size="lg">Open the River</LinkButton>
      </div>
    );
  }

  return (
    <div className="finder">
      <ProgramSearch
        choices={choices}
        value={chosen}
        onChange={choose}
        label="Your program"
        placeholder={`Search ${fmtInt(choices.length)} programs`}
        describedBy={hintId}
      />
      <p id={hintId} className="sr-only">Pick a program to see two links: where its grads went, and where it can take you.</p>
      <span className="sr-only" aria-live="polite">{chosen ? `${chosen.text} picked. Two links follow.` : ''}</span>

      {chosen && <Chosen choice={chosen} insights={insights} years={{ from: meta.counts.firstYear, to: meta.counts.lastYear }} />}

      {popular.length > 0 && (
        <div className="finder__popular" role="group" aria-labelledby={`${hintId}-pop`}>
          <span className="finder__popular-label" id={`${hintId}-pop`}>Popular</span>
          <ul className="chips" role="list">
            {popular.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={chosen?.key === p.key}
                  onClick={() => choose(p)}
                >
                  {p.program}
                  {p.tag && <span className="chip__tag">{p.tag}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The picked program: who's counted, where it ranks, and the two ways on. */
function Chosen({ choice, insights, years }: { choice: ProgramChoice; insights: InsightsFile; years: { from: number; to: number } }) {
  const ranks = programRanks(insights.rankings, choice).slice(0, 2);
  const headingId = useId();
  return (
    <Card as="section" className="chosen" aria-labelledby={headingId}>
      <div className="chosen__head">
        <h2 id={headingId} className="chosen__title">{choice.program}</h2>
        <p className="chosen__meta">
          <span className="chosen__level">{choice.levelLabel}</span>
          <span className="num">{fmtInt(choice.n)} grads in the data, classes of {years.from}–{years.to}</span>
        </p>
      </div>
      {ranks.length > 0 && (
        <ul className="chosen__ranks" role="list" aria-label="On the leaderboards">
          {ranks.map((r) => (
            <li key={r.id}>
              <span className="chosen__rank num">{ordinal(r.rank)}</span>
              <span>{r.label}: <strong className="num">{r.share}</strong></span>
            </li>
          ))}
        </ul>
      )}
      {!choice.river && (
        <p className="chosen__note">
          Fewer than {RIVER_MIN_CLASS} grads, too few for a River of its own. The River shows all {LEVEL_GRADS[choice.level]} instead.
        </p>
      )}
      <div className="chosen__actions">
        <LinkButton to={riverHref(choice)} variant="primary" size="lg">
          {choice.river ? 'See where this class went' : `See all ${LEVEL_GRADS[choice.level]}`}
          <span aria-hidden="true">→</span>
        </LinkButton>
        <LinkButton to={twinHref(choice)} size="lg">Where it can take you</LinkButton>
      </div>
      <div className="chosen__share">
        <span className="chosen__share-label">Send it to your group chat</span>
        <ShareProgram level={choice.level} program={choice.program} title={programTitle(choice.level, choice.program, choice.tag != null)} />
      </div>
    </Card>
  );
}

function ToolCard({ to, art, name, hook, cta }: { to: string; art: ReactNode; name: string; hook: string; cta: string }) {
  return (
    <Card as="li" pad="none" interactive className="tool">
      <div className="tool__art">{art}</div>
      <div className="tool__body">
        <h3 className="tool__name"><Link to={to} className="ui-card__link">{name}</Link></h3>
        <p className="tool__hook">{hook}</p>
        <span className="tool__cta" aria-hidden="true">{cta} →</span>
      </div>
    </Card>
  );
}

function EmployerList({ title, note, unit, rows, footnote }: {
  title: string; note: string; unit: string; rows: EmployerBar[]; footnote?: string | null;
}) {
  return (
    <Card className="emp">
      <h3 className="emp__title">{title}</h3>
      <p className="emp__note">{note}</p>
      <ol className="emp__list">
        {rows.map((r) => (
          <li key={r.name} className="emp__row">
            <span className="emp__rank num" aria-hidden="true">{r.rank}</span>
            <span className="emp__name">{r.name}</span>
            <span className="emp__bar" aria-hidden="true"><span style={{ width: `${Math.max(1, r.width * 100)}%` }} /></span>
            <span className="emp__value num">{fmtInt(r.n)}<span className="sr-only"> {unit}</span></span>
          </li>
        ))}
      </ol>
      {footnote && <p className="emp__foot">{footnote}</p>}
    </Card>
  );
}
