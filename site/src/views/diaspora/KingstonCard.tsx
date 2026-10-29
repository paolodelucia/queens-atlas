/**
 * The opening card: "You got your first job in Kingston. Then what?" The share who stayed (only
 * when both published counts exist), a compact flow from Kingston to where the others live now
 * (ink ribbons, width proportional to people, labelled with counts), and a button that puts the
 * same moves on the map. Every number is a published count or a share of two published counts.
 */
import { useMemo, useRef } from 'react';
import { Button, Card, StatBlock, Sticker } from '../../components/ui';
import { fmtInt } from '../../lib/format';
import { useNarrow, useWidth } from './hooks';
import { estimateTextWidth, kingstonFlowLayout, pctText, ribbonPath } from './model';
import type { KingstonStory } from './model';

const LABEL_FONT = 13;
const NODE_W = 10;
const END_W = 5;
/** Room above the ribbons for the "First job" / "Lives now" captions. */
const CAP_H = 24;

export function KingstonFlow({ story, nodeHeight = 150 }: { story: KingstonStory; nodeHeight?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef, 360);
  const layout = useMemo(() => kingstonFlowLayout(story, { nodeHeight, minSlot: 20, gap: 4 }), [story, nodeHeight]);
  // Room for the longest "Name 1,234" label, but never more than about half the width.
  const labelW = Math.min(
    width * 0.56,
    Math.max(...layout.bands.map((b) => estimateTextWidth(`${b.label} ${b.n != null ? fmtInt(b.n) : ''}`, LABEL_FONT))) + 6,
  );
  const x0 = NODE_W;
  const x1 = Math.max(x0 + 40, width - labelW - END_W - 8);
  const total = story.firstJob;
  const h = layout.height + CAP_H;

  return (
    <figure className="dsp-kflow">
      <div className="dsp-kflow__stage" ref={wrapRef}>
        <svg className="dsp-kflow__svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true">
          <text className="dsp-kflow__cap" x={0} y={11}>First job</text>
          <text className="dsp-kflow__cap" x={x1} y={11}>Lives now</text>
          <g transform={`translate(0,${CAP_H})`}>
          <rect className="dsp-kflow__node" x={0} y={0} width={NODE_W} height={layout.nodeHeight} />
          {layout.bands.map((b) => (
            <path key={b.key} className={`dsp-kflow__band is-${b.kind}`} d={ribbonPath(x0, x1, b)} />
          ))}
          {layout.bands.map((b) => (
            <rect
              key={`${b.key}-end`}
              className={`dsp-kflow__end is-${b.kind}`}
              x={x1}
              y={b.t0}
              width={END_W}
              height={Math.max(1.5, b.t1 - b.t0)}
            />
          ))}
          {layout.bands.map((b) => (
            <text key={`${b.key}-label`} className={`dsp-kflow__label is-${b.kind}`} x={x1 + END_W + 7} y={b.mid} dominantBaseline="central">
              {b.label}
              {b.n != null && <tspan className="dsp-kflow__n" dx={6}>{fmtInt(b.n)}</tspan>}
            </text>
          ))}
          </g>
        </svg>
      </div>
      <figcaption className="sr-only">
        Where alumni whose first job was in Kingston live now{total != null ? `, of ${fmtInt(total)} people` : ''}:
      </figcaption>
      <ul className="sr-only">
        {layout.bands.filter((b) => b.n != null).map((b) => (
          <li key={b.key}>{b.label}: {fmtInt(b.n!)} people{b.pct != null ? `, ${pctText(b.pct)}` : ''}</li>
        ))}
        {layout.bands.some((b) => b.kind === 'rest') && <li>Other places: not listed one by one</li>}
      </ul>
    </figure>
  );
}

export function KingstonCard({ story, oneWay, onShow }: {
  story: KingstonStory;
  /** Show the "the 401 runs mostly one way" sticker (the caller checks the moves data supports it). */
  oneWay: boolean;
  onShow(): void;
}) {
  const narrow = useNarrow();
  const top = story.elsewhere[0];
  return (
    <Card as="section" className="dsp-kcard" aria-labelledby="dsp-kingston-h">
      {oneWay && <Sticker className="dsp-kcard__sticker" tone="lime" tilt={5}>the 401 runs mostly one way</Sticker>}
      <h2 id="dsp-kingston-h" className="dsp-kcard__title">You got your first job in Kingston. Then what?</h2>
      <div className="dsp-kcard__body">
        <div className="dsp-kcard__story">
          {story.stillPct != null && story.still != null && story.firstJob != null ? (
            <StatBlock
              size="md"
              highlight
              value={pctText(story.stillPct)}
              label="still live in Kingston"
              detail={<>{fmtInt(story.still)} of the {fmtInt(story.firstJob)} alumni whose first job was there.</>}
            />
          ) : story.firstJob != null ? (
            <StatBlock size="md" value={fmtInt(story.firstJob)} label="alumni had their first job in Kingston" />
          ) : null}
          {top && (
            <p className="dsp-kcard__text">
              The most common move: <strong>{top.name}</strong>, {fmtInt(top.n)} people{top.pct != null && <> ({pctText(top.pct)})</>}.
            </p>
          )}
        </div>
        <KingstonFlow story={story} nodeHeight={narrow ? 120 : 140} />
      </div>
      <div className="dsp-kcard__foot">
        <Button variant="primary" size="sm" onClick={onShow}>
          Show Kingston’s moves on the map <span aria-hidden="true">→</span>
        </Button>
        <p className="dsp-kcard__note">All alumni with a known home. Only the biggest destinations get their own ribbon.</p>
      </div>
    </Card>
  );
}
