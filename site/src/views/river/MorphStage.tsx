import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { usePrefersReducedMotion } from './hooks';
import type { RiverTab } from './model';
import { MORPH_MS, bandAt, bandPath, easeInOut, morphOpacity, placeShape, planMorph } from './morph';
import type { MorphPlan, MorphSource } from './morph';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HATCH_ID = 'river-morph-hatch';
/** Frames to wait for the incoming chart to measure itself before morphing anyway. */
const MAX_PREP_FRAMES = 30;
/** Longest step each of the first frames may advance the morph (ms of its timeline): those paint
 *  the drawn bands for the first time and arrive late, and shouldn't skip the start. */
const FIRST_STEP_MS = 34;
const FIRST_FRAMES = 2;
/** Longest step any later frame may advance it, so a slow device still finishes in about real time. */
const MAX_STEP_MS = 100;

/** Where the two charts report their shapes (a plain holder: written by the charts' effects). */
class Sources {
  flow: MorphSource | null = null;
  years: MorphSource | null = null;
  setFlow = (s: MorphSource | null) => { this.flow = s; };
  setYears = (s: MorphSource | null) => { this.years = s; };
}

interface Els {
  stage: RefObject<HTMLDivElement | null>;
  flow: RefObject<HTMLDivElement | null>;
  years: RefObject<HTMLDivElement | null>;
  overlay: RefObject<SVGSVGElement | null>;
  sources: Sources;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Runs one morph outside React: a requestAnimationFrame loop that moves `p` (0 = Flow, 1 = Year
 * by year) toward `goal` and writes paths, opacities and the stage height straight to the DOM.
 * Steering to the other goal mid-way reverses from the current frame.
 */
class MorphEngine {
  p = 0;
  goal: 0 | 1 = 1;
  running = false;
  private prep = 0;
  private frames = 0;
  private last: number | null = null;
  private raf = 0;
  private plan: MorphPlan | null = null;
  private paths: SVGPathElement[] = [];
  private heights: [number, number] = [0, 0];
  private els: Els;
  private onDone: () => void;

  constructor(els: Els, onDone: () => void) {
    this.els = els;
    this.onDone = onDone;
  }

  /** Head for a tab; starts a morph from the other tab if none is running. */
  steer(goal: 0 | 1) {
    this.goal = goal;
    if (this.running) return;
    this.running = true;
    this.p = 1 - goal;
    this.prep = 0;
    this.frames = 0;
    this.last = null;
    this.plan = null;
    // Before the first paint with both charts mounted: hold the stage at the outgoing chart's
    // height (the layers are stacked now, so nothing below moves) and hide the incoming one.
    const from = (goal === 1 ? this.els.flow : this.els.years).current;
    const to = (goal === 1 ? this.els.years : this.els.flow).current;
    const stage = this.els.stage.current;
    if (stage && from) stage.style.height = `${from.offsetHeight}px`;
    if (from) from.style.opacity = '1';
    if (to) to.style.opacity = '0';
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    if (!this.plan) {
      const s = this.els.sources;
      const ready = !!(s.flow?.ready && s.years?.ready);
      if (!ready && ++this.prep < MAX_PREP_FRAMES) {
        this.raf = requestAnimationFrame(this.tick);
        return;
      }
      if (!this.build()) {
        this.p = this.goal;
        this.finish();
        return;
      }
      this.last = now;
    }
    // The first frames (the first paint of the drawn bands) slow the morph down a little instead
    // of skipping its start; after that it keeps to real time, smoothing over a single hiccup.
    const cap = this.frames++ < FIRST_FRAMES ? FIRST_STEP_MS : MAX_STEP_MS;
    const step = Math.min(cap, Math.max(0, now - (this.last ?? now))) / MORPH_MS;
    this.last = now;
    this.p = this.goal > this.p ? Math.min(this.goal, this.p + step) : Math.max(this.goal, this.p - step);
    this.draw();
    if (this.p === this.goal) this.finish();
    else this.raf = requestAnimationFrame(this.tick);
  };

  /** Both charts are mounted and measured: read their shapes in stage coordinates and plan. */
  private build(): boolean {
    const stage = this.els.stage.current;
    const overlay = this.els.overlay.current;
    const src = this.els.sources;
    if (!stage || !overlay || !src.flow?.svg || !src.years?.svg) return false;
    const box = stage.getBoundingClientRect();
    const place = (m: MorphSource) => {
      const r = m.svg!.getBoundingClientRect();
      const s = r.width > 0 && m.width > 0 ? r.width / m.width : 1;
      return placeShape(m.shape(), r.left - box.left, r.top - box.top, s);
    };
    const plan = planMorph(place(src.flow), place(src.years));
    if (!plan.bands.length || plan.knots < 2) return false;
    this.heights = [this.els.flow.current?.offsetHeight ?? 0, this.els.years.current?.offsetHeight ?? 0];
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(Math.max(...this.heights)));
    overlay.setAttribute('width', String(w));
    overlay.setAttribute('height', String(h));
    overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    for (const b of plan.bands) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'river-morph__band');
      path.setAttribute('data-band', b.key);
      path.style.fill = b.hatch ? `url(#${HATCH_ID})` : b.color;
      overlay.appendChild(path);
      this.paths.push(path);
    }
    this.plan = plan;
    return true;
  }

  private draw() {
    const plan = this.plan;
    if (!plan) return;
    const e = easeInOut(this.p);
    plan.bands.forEach((b, i) => {
      const f = bandAt(b, e);
      const path = this.paths[i];
      path.setAttribute('d', bandPath(f.x, f.top, f.bottom));
      path.style.fillOpacity = String(Math.round(f.opacity * 1000) / 1000);
    });
    const o = morphOpacity(this.p);
    const { stage, flow, years, overlay } = this.els;
    if (flow.current) flow.current.style.opacity = String(o.flow);
    if (years.current) years.current.style.opacity = String(o.years);
    if (overlay.current) overlay.current.style.opacity = String(o.overlay);
    if (stage.current) {
      stage.current.style.height = `${Math.round(lerp(this.heights[0], this.heights[1], e))}px`;
      stage.current.dataset.progress = this.p.toFixed(3);
    }
  }

  /** Reached the goal (or can't morph): drop the drawn bands and let React unmount the other chart. */
  private finish() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.plan = null;
    for (const p of this.paths) p.remove();
    this.paths = [];
    this.onDone();
  }

  /** Abort (or tidy up after finishing): no loop, no drawn bands, no inline styles. */
  stop() {
    if (this.running) cancelAnimationFrame(this.raf);
    this.running = false;
    this.plan = null;
    for (const p of this.paths) p.remove();
    this.paths = [];
    const { stage, flow, years, overlay } = this.els;
    if (stage.current) { stage.current.style.height = ''; delete stage.current.dataset.progress; }
    if (flow.current) flow.current.style.opacity = '';
    if (years.current) years.current.style.opacity = '';
    if (overlay.current) overlay.current.style.opacity = '';
  }
}

/** Morphing needs animation frames and a motion preference to respect (jsdom has neither). */
const canAnimate = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && typeof requestAnimationFrame === 'function';

export interface MorphHooks {
  /** Give to the chart: it reports its shape and position for the morph. */
  onMorphSource: (s: MorphSource | null) => void;
  /** The chart is being mounted for a morph (skip its own entrance animation). */
  still: boolean;
  /** This chart is the selected tab (the other one is on its way out or in). */
  current: boolean;
}

/**
 * The tab panel's chart, morphing between Flow and Year by year when the tab changes: both charts
 * are mounted, stacked, for the length of the morph; the bands are drawn in an overlay meanwhile;
 * then the other chart unmounts. With reduced motion (or no animation frames) it swaps at once.
 * `resetKey` names the data on screen: a change mid-morph ends it at once.
 */
export function MorphStage({ tab, resetKey, render }: {
  tab: RiverTab;
  resetKey: string;
  render: (tab: RiverTab, hooks: MorphHooks) => ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced && canAnimate();
  const [seenTab, setSeenTab] = useState(tab);
  const [seenKey, setSeenKey] = useState(resetKey);
  const [morphing, setMorphing] = useState(false);
  // Adjust state while rendering (React's derived-state pattern): a new tab starts a morph.
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    if (morphing) setMorphing(false);
  }
  if (seenTab !== tab) {
    setSeenTab(tab);
    if (animate && seenKey === resetKey) setMorphing(true);
  }
  if (morphing && !animate) setMorphing(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const yearsRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [sources] = useState(() => new Sources());
  const engine = useRef<MorphEngine | null>(null);

  useLayoutEffect(() => {
    const eng = new MorphEngine(
      { stage: stageRef, flow: flowRef, years: yearsRef, overlay: overlayRef, sources },
      () => setMorphing(false),
    );
    engine.current = eng;
    return () => { eng.stop(); engine.current = null; };
  }, [sources]);

  useLayoutEffect(() => {
    const eng = engine.current;
    if (!eng) return;
    if (morphing) eng.steer(tab === 'years' ? 1 : 0);
    else eng.stop();
  }, [morphing, tab]);

  const layer = (t: RiverTab) => ({
    className: 'river-layer',
    'data-layer': t,
    inert: morphing || undefined,
    'aria-hidden': morphing && t !== tab ? true : undefined,
  });
  return (
    <div ref={stageRef} className={`river-morphstage${morphing ? ' is-morphing' : ''}`}>
      {(morphing || tab === 'flow') && (
        <div ref={flowRef} {...layer('flow')}>
          {render('flow', { onMorphSource: sources.setFlow, still: morphing, current: tab === 'flow' })}
        </div>
      )}
      {(morphing || tab === 'years') && (
        <div ref={yearsRef} {...layer('years')}>
          {render('years', { onMorphSource: sources.setYears, still: morphing, current: tab === 'years' })}
        </div>
      )}
      {morphing && (
        <svg ref={overlayRef} className="river-morph" aria-hidden="true" focusable="false">
          <defs>
            <pattern id={HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="yrs-hatch__bg" />
              <line x1="0" y1="0" x2="0" y2="6" className="yrs-hatch__line" />
            </pattern>
          </defs>
        </svg>
      )}
    </div>
  );
}
