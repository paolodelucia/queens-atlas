/**
 * Figures for the Method long-read. Each one is small, plain HTML/SVG and carries its numbers
 * as text, so nothing depends on hovering or on colour alone.
 */
import { Sticker } from '../../components/ui';
import { FAMILIES, SECTORS, SENIORITY, SENIORITY_ORDER } from '../../data/taxonomy';
import type { InsightsFile, Meta } from '../../data/types';
import { fmtInt } from '../../lib/format';
import {
  NOISE_ODDS, RIVER_COLUMNS, TWIN_YEARS, classReach, decodeBase36, fmtPct1, fmtShortUtc, fmtUtc, foldSmallGroups, monthAxis,
  msToSnowflake, parseUtc, presentSticker, snapshotBars, snowflakeToMs, timelineMarks, viewedMonth,
} from './model';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── 1. Anatomy of a profile ──────────────────────────────────────────────────

const PROFILE_PARTS: { part: string; fields: string[]; use: string; used: boolean }[] = [
  { part: 'Education', fields: ['school', 'degree', 'field of study', 'start and end year'], use: 'Program, degree level and graduating class', used: true },
  { part: 'Experience', fields: ['employer', 'job title', 'start and end month', 'duration', 'job location'], use: 'The career itself: every role, in order', used: true },
  { part: 'Location', fields: ['city', 'country'], use: 'Where alumni live now (the Diaspora)', used: true },
  { part: 'Activity', fields: ['post and reaction IDs'], use: 'Only to date the snapshot', used: true },
  { part: 'Identity', fields: ['name', 'profile URL', 'photo', 'about text', 'connections'], use: 'Never used for anything on this site', used: false },
];

export function ProfileAnatomy() {
  return (
    <figure className="m-figure">
      <div className="anatomy">
        {PROFILE_PARTS.map((p) => (
          <div key={p.part} className={p.used ? 'anatomy__row' : 'anatomy__row anatomy__row--unused'}>
            <div className="anatomy__part">{p.part}</div>
            <ul className="anatomy__fields" aria-label={`${p.part} fields`}>
              {p.fields.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <div className="anatomy__use">
              <span className="anatomy__arrow" aria-hidden="true">→</span>
              {p.use}
            </div>
          </div>
        ))}
      </div>
      <figcaption>What one profile in the snapshot holds, by field. No field values are shown anywhere on this site.</figcaption>
    </figure>
  );
}

// ── 2a. "Present" arithmetic ─────────────────────────────────────────────────

export function PresentExample() {
  const start = { y: 2025, m: 1 };
  const months = 9;
  const v = viewedMonth(start.y, start.m, months);
  return (
    <div className="equation" role="group" aria-label={`${MONTHS[start.m - 1]} ${start.y} plus ${months} months minus one equals ${MONTHS[v.month - 1]} ${v.year}`}>
      <span className="equation__chip">{MONTHS[start.m - 1]} {start.y} – Present · {months} mos</span>
      <span className="equation__op" aria-hidden="true">⟶</span>
      <span className="equation__chip">{MONTHS[start.m - 1]} {start.y}</span>
      <span className="equation__op" aria-hidden="true">+</span>
      <span className="equation__chip">{months} months</span>
      <span className="equation__op" aria-hidden="true">−</span>
      <span className="equation__chip">1</span>
      <span className="equation__op" aria-hidden="true">=</span>
      <span className="equation__chip equation__chip--result">{MONTHS[v.month - 1]} {v.year}</span>
    </div>
  );
}

export function PresentChart({ rows, sample }: {
  rows: InsightsFile['snapshot']['currentRolesImplying'];
  sample?: number;
}) {
  const bars = snapshotBars(rows);
  if (bars.length === 0) return null;
  const rest = 100 - bars.reduce((a, b) => a + b.pct, 0);
  const note = presentSticker(rows);
  return (
    <figure className="m-figure m-figure--stickered">
      {note && <Sticker as="p" tilt={4} className="m-figure__sticker" aria-hidden="true">{note}</Sticker>}
      <ol className="mbars" aria-label="Share of current roles implying each viewing month">
        {bars.map((b) => (
          <li key={b.month} className={b.top ? 'mbars__row is-top' : 'mbars__row'}>
            <span className="mbars__label">{b.label}</span>
            <span className="mbars__track" aria-hidden="true"><span style={{ width: `${Math.max(0.8, b.width * 100)}%` }} /></span>
            <span className="mbars__value num">{fmtPct1(b.pct)}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        Clue 1. For every role marked “Present”, start month + duration − 1 gives the month the page was viewed.
        Shares of {sample ? `about ${fmtInt(Math.round(sample / 100) * 100)} ` : ''}current roles{rest >= 0.05 ? `; the other ${fmtPct1(Number(rest.toFixed(1)))} point to scattered other months` : ''}.
      </figcaption>
    </figure>
  );
}

// ── 2b. Snowflake IDs ────────────────────────────────────────────────────────

export function SnowflakeDemo({ newest }: { newest: string }) {
  const d = parseUtc(newest);
  if (!d) return null;
  const ms = BigInt(d.getTime());
  const id = msToSnowflake(ms);
  const back = snowflakeToMs(id);
  return (
    <figure className="m-figure">
      <pre className="code" tabIndex={0} aria-label="Decoding a LinkedIn activity ID">
        <code>
          <span className="code__c"># LinkedIn activity IDs are “snowflakes”: the top 41 bits are a Unix time in ms</span>{'\n'}
          <span className="code__k">ts_ms</span> = activity_id <span className="code__op">&gt;&gt;</span> <span className="code__n">22</span>{'\n\n'}
          <span className="code__c"># an ID shaped like the newest one in the snapshot</span>{'\n'}
          <span className="code__n">{id.toString()}</span> <span className="code__op">&gt;&gt;</span> <span className="code__n">22</span>{'\n'}
          <span className="code__r">= {back.toString()} ms</span>{'\n'}
          <span className="code__r">= {fmtUtc(new Date(Number(back)))}</span>
        </code>
      </pre>
      <figcaption>
        Clue 2. The newest activity anywhere in the file decodes to {fmtUtc(d)}. The ID above is rebuilt from that
        timestamp for illustration; it is not a real post.
      </figcaption>
    </figure>
  );
}

// ── 2c. Base36 file name ─────────────────────────────────────────────────────

const EXPORT_PREFIX = 'mg5xrzjc';

export function Base36Demo({ exportTs }: { exportTs: string }) {
  const ms = decodeBase36(EXPORT_PREFIX);
  const decoded = ms === null ? null : new Date(ms);
  const reported = parseUtc(exportTs);
  return (
    <figure className="m-figure">
      <pre className="code" tabIndex={0} aria-label="Decoding the export file name">
        <code>
          <span className="code__c">{'// the export file is called snap_'}{EXPORT_PREFIX}…</span>{'\n'}
          <span className="code__k">parseInt</span>(<span className="code__s">"{EXPORT_PREFIX}"</span>, <span className="code__n">36</span>){'\n'}
          <span className="code__r">= {ms === null ? '—' : fmtInt(ms).replace(/,/g, '')} ms</span>{'\n'}
          <span className="code__r">= {fmtUtc(decoded)}</span>
        </code>
      </pre>
      <figcaption>
        Clue 3. The companion export’s name starts with a base-36 timestamp: {fmtUtc(decoded ?? reported)}, minutes after
        the newest activity. (This decode runs live in your browser.)
      </figcaption>
    </figure>
  );
}

// ── 2d. The verdict timeline ─────────────────────────────────────────────────

export function EvidenceTimeline({ snapshot }: { snapshot: InsightsFile['snapshot'] }) {
  const asOf = parseUtc(snapshot.asOf);
  const axis = monthAxis(asOf);
  if (!axis || !asOf) return null;
  const month = MONTHS[axis.from.getUTCMonth()];
  const year = axis.from.getUTCFullYear();
  const day = (d: number) => new Date(Date.UTC(year, axis.from.getUTCMonth(), d));
  const marks = timelineMarks([
    { id: 'activity', label: 'Newest activity', date: parseUtc(snapshot.newestActivity) },
    { id: 'export', label: 'Export file written', date: parseUtc(snapshot.exportFileTimestamp) },
    // The as-of date is a whole day: mark its end.
    { id: 'asof', label: 'As-of date', date: new Date(asOf.getTime() + 86_399_000) },
  ], axis.from, axis.to).sort((a, b) => b.x - a.x); // rightmost on top, so no leader line crosses a label
  const text = (m: { id: string; date: Date }) => (m.id === 'asof' ? `${month} ${asOf.getUTCDate()}, ${year}` : fmtShortUtc(m.date));
  // The capture's bulk window (pipeline/02_snapshot_date.py: most profiles Sep 2–10).
  const [b0, b1] = timelineMarks([
    { id: 'b0', label: '', date: day(2) },
    { id: 'b1', label: '', date: day(11) },
  ], axis.from, axis.to);
  const days = Math.round((axis.to.getTime() - axis.from.getTime()) / 86_400_000);
  const ticks = [1, 8, 15, 22].filter((d) => d <= days);
  const n = marks.length;

  return (
    <figure className="m-figure">
      <div
        className="tl"
        role="img"
        aria-label={`Timeline of ${month} ${year}: most profiles captured ${month} 2 to 10; ${marks.map((m) => `${m.label.toLowerCase()} ${text(m)}`).join('; ')}.`}
      >
        <div className="tl__labels" aria-hidden="true" style={{ height: `${n * 2.4 + 0.4}em` }}>
          {marks.map((m, i) => (
            <div key={m.id} className={`tl__label tl__label--${m.id}`} style={{ right: `${(1 - m.x) * 100}%`, top: `${i * 2.4}em` }}>
              <strong>{m.label}</strong> <span className="num">{text(m)}</span>
              <span className="tl__leader" style={{ height: `calc(${(n - i) * 2.4 - 1.1}em + 13px)` }} />
            </div>
          ))}
          {b0 && b1 && <span className="tl__bandlabel" style={{ left: `${b0.x * 100}%` }}>Most profiles captured</span>}
        </div>
        <div className="tl__axis" aria-hidden="true">
          {b0 && b1 && <span className="tl__band" style={{ left: `${b0.x * 100}%`, width: `${(b1.x - b0.x) * 100}%` }} />}
          {marks.map((m) => <span key={m.id} className={`tl__dot tl__dot--${m.id}`} style={{ left: `${m.x * 100}%` }} />)}
        </div>
        <div className="tl__ticks" aria-hidden="true">
          {ticks.map((d) => <span key={d} style={{ left: `${((d - 1) / days) * 100}%` }}>{month} {d}</span>)}
        </div>
      </div>
      <figcaption>
        Three independent clues, one answer. Most pages were captured in the first ten days of the month, with a smaller
        re-crawl later on. Atlas treats every profile as of {fmtDayShort(asOf)}.
      </figcaption>
    </figure>
  );
}

const fmtDayShort = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// ── 3. Labels ────────────────────────────────────────────────────────────────

export function LabelExample() {
  return (
    <figure className="m-figure">
      <div className="label-ex">
        <div className="label-ex__in">
          <span className="label-ex__tag">Input string</span>
          <code>Sr. SWE II - Payments @ Shopify</code>
        </div>
        <span className="label-ex__arrow" aria-hidden="true">→</span>
        <dl className="label-ex__out">
          <div><dt>function</dt><dd>software_engineering</dd></div>
          <div><dt>seniority</dt><dd>senior</dd></div>
          <div><dt>canonical title</dt><dd>Senior Software Engineer</dd></div>
          <div><dt>student role</dt><dd>no</dd></div>
          <div><dt>ambiguous</dt><dd>no</dd></div>
        </dl>
      </div>
      <figcaption>The worked example from the labelling prompt: a messy title in, a structured label out, validated against a JSON schema.</figcaption>
    </figure>
  );
}

export function TaxonomyChips() {
  return (
    <figure className="m-figure">
      <div className="taxo">
        {SECTORS.filter((s) => s.id !== 'neutral').map((s) => (
          <div key={s.id} className="taxo__sector">
            <div className="taxo__head"><span className="taxo__swatch" style={{ background: s.color }} aria-hidden="true" />{s.label}</div>
            <ul>
              {FAMILIES.filter((f) => f.sector === s.id).map((f) => (
                <li key={f.id}><strong>{f.label}</strong><span>{f.description}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <figcaption>
        Career families (bold) roll up into eight colour sectors, the colours used across Atlas. “Further study” is a
        state rather than a job; “Other roles”, “No role listed” and “Smaller groups” are drawn in grey.
      </figcaption>
    </figure>
  );
}

export function SeniorityLadder() {
  const steps = SENIORITY_ORDER.filter((s) => s !== 'unknown');
  return (
    <figure className="m-figure">
      <ol className="ladder">
        {steps.map((s, i) => (
          <li key={s} style={{ ['--step' as string]: i }}>
            <span className="ladder__bar" aria-hidden="true" />
            <span className="ladder__label">{SENIORITY[s]}</span>
          </li>
        ))}
      </ol>
      <figcaption>Seniority, read from the title alone. Titles that give no clue are “unknown”.</figcaption>
    </figure>
  );
}

// ── 4. Years and columns ─────────────────────────────────────────────────────

const RIVER_YEARS = new Set(RIVER_COLUMNS.map((c) => c.year).filter((y): y is number => y !== null));
const TWIN_SET = new Set<number>(TWIN_YEARS);

/**
 * The years a career path is read at: year 0 (first job) to year 20, then today. River columns
 * are the big marks; Career Twin's years and the rest of the trajectory are the small ones.
 */
export function YearRuler({ snapshotLabel }: { snapshotLabel: string }) {
  const years = Array.from({ length: 21 }, (_, i) => i);
  const kind = (y: number) => (y === 0 || RIVER_YEARS.has(y) ? 'river' : TWIN_SET.has(y) ? 'twin' : 'year');
  return (
    <figure className="m-figure">
      <div
        className="ruler"
        role="img"
        aria-label={`Every career path is read at year 0 (the first job), each June from year 1 to year 20, and today (${snapshotLabel}). River columns: first job, years 3, 5, 10 and 20, and today. Career Twin: years 0, 1, 2, 3, 5, 7, 10, 15 and 20, and today.`}
      >
        <ol className="ruler__track" aria-hidden="true">
          {years.map((y) => (
            <li key={y} className={`ruler__tick ruler__tick--${kind(y)}`}>
              <span className="ruler__dot" />
              {kind(y) === 'river' && <span className="ruler__label">{y === 0 ? 'First' : `Y${y}`}</span>}
            </li>
          ))}
          <li className="ruler__tick ruler__tick--river ruler__tick--today">
            <span className="ruler__dot" />
            <span className="ruler__label">Today</span>
          </li>
        </ol>
        <ul className="ruler__key" aria-hidden="true">
          <li><span className="ruler__swatch ruler__swatch--river" />River column, also in Career Twin</li>
          <li><span className="ruler__swatch ruler__swatch--twin" />Career Twin</li>
          <li><span className="ruler__swatch ruler__swatch--year" />Year-by-year chart only</li>
        </ul>
      </div>
      <figcaption>
        Twenty-one Junes and today. Year 0 is the first job; every other year is the main job held that June. Today is {snapshotLabel}.
      </figcaption>
    </figure>
  );
}

/** Which River columns each five-year class gets, computed from meta.cohorts and the snapshot. */
export function ClassReach({ cohorts, snapshot }: { cohorts: Meta['cohorts']; snapshot: string }) {
  const rows = classReach(cohorts, snapshot);
  if (rows.length === 0) return null;
  return (
    <figure className="m-figure">
      <div className="reach-wrap" tabIndex={0} role="region" aria-label="River columns by class">
        <table className="reach">
          <caption className="sr-only">River columns each class has reached</caption>
          <thead>
            <tr>
              <th scope="col">Class</th>
              {RIVER_COLUMNS.map((c) => <th key={c.id} scope="col">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === 'all' ? 'reach__all' : undefined}>
                <th scope="row" className="num">{r.label}</th>
                {RIVER_COLUMNS.map((c) => {
                  const has = r.columns.includes(c.id);
                  return (
                    <td key={c.id} className={has ? 'is-on' : 'is-off'}>
                      <span className="reach__mark" aria-hidden="true" />
                      <span className="sr-only">{has ? 'yes' : 'not yet'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption>
        A River column appears once every member of the class has reached it, so younger classes have fewer. All classes
        together go straight from the first job to today.
      </figcaption>
    </figure>
  );
}

// ── 5. Privacy: folding small groups ─────────────────────────────────────────

/** Made-up counts; the small ones sit just under the floor, whatever the floor is. */
function foldExample(k: number) {
  return [
    { label: 'Finance & accounting', n: 142 },
    { label: 'Consulting & strategy', n: 38 },
    { label: 'Tech', n: 21 },
    { label: 'Law', n: Math.max(1, k - 1) },
    { label: 'Teaching', n: Math.max(1, k - 2) },
    { label: 'Founders', n: Math.max(1, k - 3) },
  ];
}

type FoldRow = { label: string; n: number; small?: boolean; folded?: boolean };

function FoldBars({ rows, kind, max }: { rows: FoldRow[]; kind: string; max: number }) {
  return (
    <ul className="fold__list" aria-label={kind}>
      {rows.map((g) => (
        <li key={g.label} className={g.small ? 'is-small' : g.folded ? 'is-folded' : undefined}>
          <span className="fold__label">{g.label}</span>
          <span className="fold__bar" aria-hidden="true"><span style={{ width: `${Math.max(1.5, (g.n / max) * 100)}%` }} /></span>
          <span className="fold__n num">{g.small ? `${g.n} (hidden)` : fmtInt(g.n)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The career-field floor at work: fields under k fold into "Smaller groups". */
export function FoldIllustration({ k }: { k: number }) {
  const raw = foldExample(k).sort((a, b) => b.n - a.n);
  const shown = foldSmallGroups(raw, k);
  const max = Math.max(1, ...raw.map((g) => g.n), ...shown.map((g) => g.n));
  return (
    <figure className="m-figure">
      <div className="fold">
        <div>
          <p className="fold__title">Counted in the pipeline</p>
          <FoldBars rows={raw.map((g) => ({ ...g, small: g.n < k }))} kind="Counts before the privacy rule" max={max} />
        </div>
        <div>
          <p className="fold__title">Published</p>
          <FoldBars rows={shown} kind="Counts after the privacy rule" max={max} />
        </div>
      </div>
      <figcaption>
        Illustrative numbers. Any career field under {k} people is folded into “Smaller groups”, which is itself published
        only once it reaches {k}. The published counts are then perturbed, as described below.
      </figcaption>
    </figure>
  );
}

/** How often a count moves by each amount: the shape of the noise, not any real count. */
export function NoiseOdds() {
  const max = Math.max(...NOISE_ODDS.map((o) => o.pct));
  const sign = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0');
  return (
    <figure className="m-figure">
      <ol className="odds" aria-label="How often a published count is moved by each amount">
        {NOISE_ODDS.map((o) => (
          <li key={o.delta} className={o.delta === 0 ? 'odds__col is-zero' : 'odds__col'}>
            <span className="odds__pct num">{o.pct}%</span>
            <span className="odds__bar" aria-hidden="true" style={{ height: `${(o.pct / max) * 100}%` }} />
            <span className="odds__delta num"><span className="sr-only">moved by </span>{sign(o.delta)}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        The noise on any one count: 40% are published exactly, 40% move by one person, 20% by two. A count never moves
        below its floor.
      </figcaption>
    </figure>
  );
}

// ── 5b. Privacy: why numbers don't add up exactly ────────────────────────────

/** Made-up numbers for the differencing example (labelled as illustrative on the page). */
const NOISE_EXAMPLE = {
  whole: { label: 'Grads of one program living in one city', truth: 57, noise: 1 },
  part: { label: 'The same, leaving out the newest class', truth: 50, noise: -1 },
  maxNoise: 2,
};

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

export function NoiseExample() {
  const { whole, part, maxNoise } = NOISE_EXAMPLE;
  const exact = whole.truth - part.truth;
  const pubWhole = whole.truth + whole.noise;
  const pubPart = part.truth + part.noise;
  const diff = pubWhole - pubPart;
  const lo = Math.max(0, diff - 2 * maxNoise);
  const hi = diff + 2 * maxNoise;
  return (
    <figure className="m-figure">
      <div className="noise">
        <div className="noise__panel">
          <p className="noise__title">If counts were exact</p>
          <dl className="noise__rows">
            <div><dt>{whole.label}</dt><dd className="num">{whole.truth}</dd></div>
            <div><dt>{part.label}</dt><dd className="num">{part.truth}</dd></div>
            <div className="noise__result"><dt>Subtract: the newest class in that city</dt><dd className="num">{exact}</dd></div>
          </dl>
          <p className="noise__verdict">A group of {exact}, too small to publish, recovered exactly.</p>
        </div>
        <div className="noise__panel">
          <p className="noise__title">With cell-key noise</p>
          <dl className="noise__rows">
            <div>
              <dt>{whole.label}</dt>
              <dd className="num">{pubWhole}<span className="noise__nudge">{whole.truth} {signed(whole.noise)}</span></dd>
            </div>
            <div>
              <dt>{part.label}</dt>
              <dd className="num">{pubPart}<span className="noise__nudge">{part.truth} {signed(part.noise)}</span></dd>
            </div>
            <div className="noise__result"><dt>Subtract</dt><dd className="num">{diff}?</dd></div>
          </dl>
          <p className="noise__verdict">
            Each count may be off by up to {maxNoise}, so the hidden group could be anywhere from {lo} to {hi}.
          </p>
        </div>
      </div>
      <figcaption>
        Illustrative numbers, made up for this example (not from the data). Small grey figures show the true count and its
        nudge, which readers of the real site never see.
      </figcaption>
    </figure>
  );
}
