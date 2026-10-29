import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { FAMILY, STAGES } from '../../data/taxonomy';
import type { FamilyId, StageId } from '../../data/types';
import { fmtInt, fmtPct } from '../../lib/format';
import { useElementWidth, usePrefersReducedMotion, useTweenedLayout } from './hooks';
import { layoutRiver, linkPath, minChartWidth, textWidth, tooltipSlotX } from './layout';
import type { LayoutOptions, RLink, RNode, RiverLayout } from './layout';
import { FIELD_FLOOR, familyDescription, familyLabel, familyShort, groupColor, isSectorGroup, stageYear } from './model';
import type { GroupId, SankeyInput, ViewSlice } from './model';
import { sankeyShape } from './morph';
import type { MorphSource } from './morph';

type Target = { kind: 'node' | 'link'; id: string };

const FALLBACK_WIDTH = 960; // before the first measurement (and in jsdom)

/** Room (px) the labels beside column `i` need: the widest "Name 12%" plus the gap to the bar. */
function labelRoom(input: SankeyInput, i: number, fontSize: number): number {
  let w = 0;
  for (const d of input.nodes) {
    if (d.stageIndex !== i) continue;
    w = Math.max(w, textWidth(familyShort(d.family), fontSize) + 4 + textWidth(fmtPct(d.value, input.n), fontSize));
  }
  return w + 7 + 4;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function chartOptions(width: number, input: SankeyInput): Omit<LayoutOptions, 'width'> & { fontSize: number } {
  const narrow = width < 560;
  const fontSize = narrow ? 11 : 12;
  const counts = new Map<number, number>();
  for (const d of input.nodes) counts.set(d.stageIndex, (counts.get(d.stageIndex) ?? 0) + 1);
  const maxNodes = Math.max(1, ...counts.values());
  const k = input.stages.length;
  const height = Math.round(Math.min(720, Math.max(narrow ? 300 : 340, maxNodes * (narrow ? 28 : 31) + 84)));
  return {
    height,
    fontSize,
    nodeWidth: narrow ? 10 : 12,
    nodePadding: narrow ? 6 : 8,
    margin: {
      top: 50,
      // First-column labels sit on the left, every other column's on the right.
      left: k > 1 ? clamp(labelRoom(input, 0, fontSize), 56, 180) : 16,
      right: clamp(labelRoom(input, k - 1, fontSize), 56, 180),
      bottom: 6,
    },
    labelSpacing: narrow ? 14 : 15,
    // Two columns fit a phone; three or four scroll sideways rather than squash the headers.
    minGap: narrow ? (k > 2 ? 140 : 56) : 136,
  };
}

/** Column header: [stage name, sub-line]. `compact` splits the one long name for narrow gaps. */
function stageHeader(stage: StageId, snapshot: string, compact: boolean): [string, string] {
  if (stage === 's0') return compact ? ['First', 'destination'] : [STAGES.s0.label, 'first job or study'];
  if (stage === 'now') return [STAGES.now.label, snapshot];
  const year = stageYear(stage);
  return [STAGES[stage]?.label ?? String(stage), typeof year === 'number' ? `${year} years out` : ''];
}

export interface RiverChartProps {
  /** Id on the chart's wrapper (the target of the switches' aria-controls). */
  id?: string;
  slice: ViewSlice;
  input: SankeyInput;
  /** Changes whenever the data (not the size) changes; drives the morph transition. */
  sliceKey: string;
  /** e.g. "Sep 2025", shown under "Today". */
  snapshot: string;
  /** Accessible name of the chart, e.g. "Commerce, class of 2005–2015". */
  title: string;
  /** Stages the slice has that this chart leaves out (phones show first and last only). */
  hiddenStages?: StageId[];
  /** Smallest published count of people by field (meta.k.field). */
  floor?: number;
  /** Mounted mid-morph (a tab switch): skip the left-to-right reveal. Read once, at mount. */
  still?: boolean;
  /** Hands the tab-switch morph this chart's bars and where they are (null on unmount). */
  onMorphSource?: (source: MorphSource | null) => void;
}

export function RiverChart({
  id, slice, input, sliceKey, snapshot, title, hiddenStages = [], floor = FIELD_FLOOR, still = false, onMorphSource,
}: RiverChartProps) {
  const [quiet] = useState(still);
  const uid = useId();
  const tipId = `${uid}-tip`;
  const hintId = `${uid}-hint`;
  const [setScroller, measured] = useElementWidth<HTMLDivElement>();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const placeTip = useRef<(() => void) | null>(null);
  const reduced = usePrefersReducedMotion();

  const available = measured || FALLBACK_WIDTH;
  const opts = useMemo(() => chartOptions(available, input), [available, input]);
  const width = Math.max(available, minChartWidth(input.stages.length, opts));
  const layout = useMemo(() => layoutRiver(input, { ...opts, width }, sliceKey), [input, opts, width, sliceKey]);
  const frame = useTweenedLayout(layout, reduced ? 0 : 720);
  const overflowing = measured > 0 && width > measured + 1;

  // The morph reads the bars as they will be once settled (the layout, not a mid-tween frame).
  useLayoutEffect(() => {
    if (!onMorphSource) return;
    onMorphSource({ svg: svgRef.current, width: layout.width, ready: measured > 0, shape: () => sankeyShape(layout) });
    return () => onMorphSource(null);
  }, [onMorphSource, layout, measured]);
  // "FIRST DESTINATION" needs ~130px; split it when columns sit closer than that.
  const compactHeaders = layout.stages.length > 1 && layout.stages[1].x - layout.stages[0].x < 136;
  const flowsHidden = hiddenStages.length > 0;

  // ── Interaction state ────────────────────────────────────────────────────
  const [hover, setHover] = useState<Target | null>(null);
  const [pinned, setPinned] = useState<Target | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  /** Escape hides the current hover/focus tooltip until the target changes (WCAG 1.4.13). */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const nodeMap = useMemo(() => new Map(layout.nodes.map((d) => [d.id, d])), [layout]);
  const linkMap = useMemo(() => new Map(layout.links.map((d) => [d.id, d])), [layout]);
  // Targets that no longer exist after a filter change are ignored rather than reset.
  const { pin, active } = useMemo(() => {
    const live = (t: Target | null) => (t && (t.kind === 'node' ? nodeMap.has(t.id) : linkMap.has(t.id)) ? t : null);
    const p = live(pinned);
    const f: Target | null = focused && nodeMap.has(focused) ? { kind: 'node', id: focused } : null;
    const a = live(hover) ?? f ?? p;
    return { pin: p, active: a && `${a.kind}:${a.id}` !== dismissed ? a : null };
  }, [pinned, hover, focused, dismissed, nodeMap, linkMap]);
  const activeKey = active ? `${active.kind}:${active.id}` : '';
  const tabStop = cursor && nodeMap.has(cursor) ? cursor : layout.nodes[0]?.id;

  const highlight = useMemo(() => {
    if (!activeKey) return null;
    const [kind, ...rest] = activeKey.split(':');
    const id = rest.join(':');
    const nodes = new Set<string>();
    const links = new Set<string>();
    if (kind === 'node') {
      nodes.add(id);
      for (const l of layout.links) {
        if (l.source === id || l.target === id) { links.add(l.id); nodes.add(l.source); nodes.add(l.target); }
      }
    } else {
      const l = layout.links.find((x) => x.id === id);
      if (l) { links.add(l.id); nodes.add(l.source); nodes.add(l.target); }
    }
    return { nodes, links };
  }, [activeKey, layout]);

  // Escape clears the pin and hides the tooltip, from anywhere on the page.
  useEffect(() => {
    if (!activeKey) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(null);
      setDismissed(activeKey);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeKey]);

  // Tooltip placement: beside the node (or the pointer for flows), flipped and clamped to the card.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    const scroller = scrollerRef.current;
    if (!tip || !wrap || !svg || !active) { placeTip.current = null; return; }
    const place = () => {
      const wr = wrap.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      let right: number, left: number, y: number;
      if (active.kind === 'node') {
        const d = nodeMap.get(active.id);
        if (!d) return;
        right = sr.left - wr.left + d.x1;
        left = sr.left - wr.left + d.x0;
        y = sr.top - wr.top + (d.y0 + d.y1) / 2;
      } else {
        const l = linkMap.get(active.id);
        if (!l) return;
        const p = pointer.current ?? { x: sr.left + (l.x0 + l.x1) / 2, y: sr.top + (l.y0 + l.y1) / 2 };
        right = left = p.x - wr.left;
        y = p.y - wr.top;
      }
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const gap = 14;
      let x = right + gap;
      if (x + tw > wr.width - 4) x = left - gap - tw;
      let top: number;
      if (active.kind === 'node') {
        // Keep the tooltip off the flows and labels the hover just lit up, when there's room
        // on screen; otherwise it sits beside the node.
        const slot = tooltipSlotX(layout, nodeMap.get(active.id)?.stageIndex ?? 0, tw, opts.margin.right - 8);
        if (slot != null) {
          const sx = sr.left - wr.left + slot;
          if (sx >= 4 && sx + tw <= wr.width - 4) x = sx;
        }
        top = y - th / 2;
      } else {
        // Flows: above the pointer so the ribbon under it stays visible; below if no room.
        top = y - th - 12 >= 0 ? y - th - 12 : y + 18;
      }
      x = Math.max(4, Math.min(x, wr.width - tw - 4));
      top = Math.max(0, Math.min(top, Math.max(0, wr.height - th)));
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(top)}px)`;
    };
    place();
    placeTip.current = place;
    scroller?.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      scroller?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [active, nodeMap, linkMap, layout, opts]);

  // ── Event handlers (delegated on the svg) ────────────────────────────────
  const targetOf = (el: EventTarget | null): Target | null => {
    const hit = (el as Element | null)?.closest?.('[data-node],[data-link]');
    if (!hit) return null;
    const node = hit.getAttribute('data-node');
    if (node) return { kind: 'node', id: node };
    const link = hit.getAttribute('data-link');
    return link ? { kind: 'link', id: link } : null;
  };
  const same = (a: Target | null, b: Target | null) => a?.kind === b?.kind && a?.id === b?.id;

  const onPointerOver = (e: PointerEvent<SVGSVGElement>) => {
    const t = targetOf(e.target);
    pointer.current = { x: e.clientX, y: e.clientY };
    if (!same(hover, t)) { setHover(t); setDismissed(null); }
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    if (active?.kind === 'link') placeTip.current?.();
  };
  const onPointerLeave = () => { setHover(null); setDismissed(null); };
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const t = targetOf(e.target);
    pointer.current = { x: e.clientX, y: e.clientY };
    setDismissed(null);
    if (!t) { setPinned(null); return; }
    setPinned((p) => (same(p, t) ? null : t));
    if (t.kind === 'node') setCursor(t.id);
  };

  const focusNode = useCallback((id: string | undefined) => {
    if (!id) return;
    setCursor(id);
    const el = svgRef.current?.querySelector<SVGGElement>(`[data-node="${id}"]`);
    el?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const t = targetOf(e.target);
    if (!t || t.kind !== 'node') return;
    const d = nodeMap.get(t.id);
    if (!d) return;
    const column = (i: number) => layout.nodes.filter((n) => n.stageIndex === i);
    const col = column(d.stageIndex);
    const at = col.findIndex((n) => n.id === d.id);
    let next: string | undefined;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        setDismissed(null);
        setPinned((p) => (p?.kind === 'node' && p.id === d.id ? null : { kind: 'node', id: d.id }));
        return;
      case 'ArrowUp': next = col[at - 1]?.id; break;
      case 'ArrowDown': next = col[at + 1]?.id; break;
      case 'Home': next = col[0]?.id; break;
      case 'End': next = col[col.length - 1]?.id; break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const other = column(d.stageIndex + (e.key === 'ArrowLeft' ? -1 : 1));
        const cy = (d.y0 + d.y1) / 2;
        next = (other.find((n) => n.family === d.family)
          ?? [...other].sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - cy) - Math.abs((b.y0 + b.y1) / 2 - cy))[0])?.id;
        break;
      }
      default: return;
    }
    e.preventDefault();
    focusNode(next);
  };
  const onFocus = (e: FocusEvent<SVGSVGElement>) => {
    const t = targetOf(e.target);
    if (t?.kind !== 'node') return;
    setCursor(t.id);
    // Only keyboard focus shows the tooltip; a mouse click already pins or un-pins.
    if (isFocusVisible(e.target as Element)) { setFocused(t.id); setDismissed(null); }
  };
  const onBlur = (e: FocusEvent<SVGSVGElement>) => {
    if (!targetOf(e.relatedTarget)) setFocused(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const n = slice.n;
  const hitBands = useMemo(() => nodeHitBands(frame), [frame]);
  const activeNode = active?.kind === 'node' ? nodeMap.get(active.id) : undefined;
  const activeLink = active?.kind === 'link' ? linkMap.get(active.id) : undefined;
  const stageList = input.stages.map((s) => STAGES[s]?.label ?? s).join(' and ');

  return (
    <div id={id} className="river-chart" ref={wrapRef}>
      {overflowing && <p className="river-chart__swipe" aria-hidden="true">Swipe sideways to follow the river →</p>}
      <div
        className="river-chart__scroll"
        ref={(el) => { scrollerRef.current = el; setScroller(el); }}
      >
        <svg
          ref={svgRef}
          className={`river-svg${quiet ? ' river-svg--still' : ''}`}
          width={Math.round(frame.width)}
          height={Math.round(frame.height)}
          role="group"
          aria-label={`River chart: ${title}. ${frame.nodes.length} bars across ${input.stages.length} stages${flowsHidden ? ` (${stageList} only)` : ''}.`}
          aria-describedby={hintId}
          data-active={active ? 'true' : undefined}
          onPointerOver={onPointerOver}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <rect className="river-svg__bg" width={frame.width} height={frame.height} />
          <g aria-hidden="true">
            {frame.stages.map((s) => {
              const [head, sub] = stageHeader(s.id, snapshot, compactHeaders);
              return (
                <g key={s.id} transform={`translate(${s.x},0)`} style={{ opacity: s.opacity }}>
                  <text className="river-stage" y={18}>{head}</text>
                  <text className="river-stage__sub" y={35}>{sub}</text>
                </g>
              );
            })}
          </g>
          <g className="river-links" aria-hidden="true">
            {frame.links.map((l) => (
              <path
                key={l.id}
                className={`river-link${highlight ? (highlight.links.has(l.id) ? ' is-hl' : ' is-dim') : ''}`}
                d={linkPath(l)}
                style={{ stroke: groupColor(l.from), strokeWidth: Math.max(1, l.width), opacity: l.opacity }}
              />
            ))}
          </g>
          <g className="river-hits" aria-hidden="true">
            {[...frame.links].reverse().map((l) => (
              <path key={l.id} data-link={l.id} className="river-hit" d={linkPath(l)} style={{ strokeWidth: Math.max(9, l.width) }} />
            ))}
          </g>
          <g className="river-nodes">
            {frame.nodes.map((d) => {
              const band = hitBands.get(d.id) ?? { y0: d.y0 - 4, y1: d.y1 + 4 };
              const h = Math.max(1.5, d.y1 - d.y0);
              const y = (d.y0 + d.y1) / 2 - h / 2;
              const dim = highlight && !highlight.nodes.has(d.id);
              const isPinned = pin?.kind === 'node' && pin.id === d.id;
              const isTabStop = d.id === tabStop;
              return (
                <g
                  key={d.id}
                  data-node={d.id}
                  className={`river-node${dim ? ' is-dim' : ''}${isPinned ? ' is-pinned' : ''}`}
                  style={{ opacity: d.opacity }}
                  role="button"
                  tabIndex={isTabStop ? 0 : -1}
                  aria-pressed={isPinned}
                  aria-label={`${familyLabel(d.family)}, ${STAGES[d.stage]?.label ?? d.stage}: ${fmtInt(d.value)} people, ${fmtPct(d.value, n)} of the class`}
                  aria-describedby={activeNode?.id === d.id ? tipId : undefined}
                >
                  <rect className="river-node__hit" x={d.x0 - 7} y={band.y0} width={d.x1 - d.x0 + 14} height={Math.max(0, band.y1 - band.y0)} />
                  <rect className="river-node__bar" x={d.x0} y={y} width={d.x1 - d.x0} height={h} rx={Math.min(2, h / 2)} style={{ fill: groupColor(d.family) }} />
                  <rect className="river-node__ring" x={d.x0 - 3} y={y - 3} width={d.x1 - d.x0 + 6} height={h + 6} rx={4} />
                </g>
              );
            })}
          </g>
          <g className="river-labels" aria-hidden="true" style={{ fontSize: opts.fontSize }}>
            {frame.nodes.filter((d) => d.labelOpacity > 0.02).map((d) => {
              const dim = highlight && !highlight.nodes.has(d.id);
              const left = d.labelSide === 'left';
              return (
                <g key={d.id} className={`river-label${dim ? ' is-dim' : ''}`}>
                  <text
                    data-node={d.id}
                    x={left ? d.x0 - 7 : d.x1 + 7}
                    y={(d.y0 + d.y1) / 2}
                    dy="0.35em"
                    textAnchor={left ? 'end' : 'start'}
                    style={{ opacity: d.labelOpacity }}
                  >
                    <tspan className="river-label__name">{familyShort(d.family)}</tspan>
                    <tspan className="river-label__pct" dx={4}>{fmtPct(d.value, n)}</tspan>
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p id={hintId} className="river-chart__hint">
        {/* Phones only: on wider screens this line sits in the card bar above the chart. */}
        <span className="river-chart__key">Related fields share a colour.</span>{' '}
        {flowsHidden
          ? <span>Showing {stageList.toLowerCase()} only; add {hiddenStages.length > 1 ? 'the years between' : 'the year between'} to see who moved where.</span>
          : <span className="river-chart__hint-pointer">Hover or tap a field to trace its flows; click to pin it, Esc to clear.</span>}{' '}
        <span className="sr-only">Keyboard: Tab into the chart, use the arrow keys to move between fields, Enter to pin a field’s flows, Escape to clear. Every number is also in the table view.</span>
      </p>
      <div ref={tipRef} id={tipId} className="river-tip" role="tooltip" hidden={!active}>
        {activeNode && <NodeTip d={activeNode} slice={slice} layout={layout} pinned={pin?.id === activeNode.id} floor={floor} />}
        {activeLink && <LinkTip l={activeLink} slice={slice} nodeMap={nodeMap} />}
      </div>
    </div>
  );
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true; // engines without :focus-visible (jsdom): treat focus as keyboard focus
  }
}

/** 1-D Voronoi for node hover: each node owns the vertical band up to halfway to its neighbours. */
function nodeHitBands(frame: RiverLayout): Map<string, { y0: number; y1: number }> {
  const out = new Map<string, { y0: number; y1: number }>();
  const cols = new Map<number, RNode[]>();
  for (const d of frame.nodes) cols.set(d.stageIndex, [...(cols.get(d.stageIndex) ?? []), d]);
  for (const col of cols.values()) {
    const sorted = [...col].sort((a, b) => a.y0 - b.y0);
    sorted.forEach((d, i) => {
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      const y0 = prev ? (prev.y1 + d.y0) / 2 : d.y0 - 6;
      const y1 = next ? (d.y1 + next.y0) / 2 : d.y1 + 6;
      out.set(d.id, { y0: Math.min(y0, d.y0 - 1), y1: Math.max(y1, d.y1 + 1) });
    });
  }
  return out;
}

function Key({ family }: { family: GroupId | string }) {
  return <span className="river-tip__key" style={{ background: groupColor(family) }} aria-hidden="true" />;
}

/** A tooltip list row; long names (employers, titles) wrap to a second line before truncating. */
function Row({ name, value, family }: { name: string; value: number; family?: GroupId }) {
  return (
    <li>
      <span className="river-tip__item">{family && <Key family={family} />}{name}</span>
      <span className="num">{fmtInt(value)}</span>
    </li>
  );
}

function NodeTip({ d, slice, layout, pinned, floor }: { d: RNode; slice: ViewSlice; layout: RiverLayout; pinned: boolean; floor: number }) {
  const det = slice.details[d.stage]?.[d.family];
  const parts = slice.parts?.[d.stage]?.[d.family];
  const sector = isSectorGroup(d.family);
  const isJobField = FAMILY[d.family as FamilyId]?.isJob ?? sector;
  const desc = !sector && !isJobField ? familyDescription(d.family, floor) : null;
  const outs = layout.links.filter((l) => l.source === d.id).sort((a, b) => b.value - a.value);
  const ins = layout.links.filter((l) => l.target === d.id).sort((a, b) => b.value - a.value);
  const flows = outs.length ? outs : ins;
  const flowStage = outs.length ? outs[0]?.toStage : ins[0]?.fromStage;
  return (
    <>
      <p className="river-tip__eyebrow">{STAGES[d.stage]?.label ?? d.stage}</p>
      <div className="river-tip__head">
        <Key family={d.family} />
        <span className="river-tip__name">{familyLabel(d.family)}</span>
      </div>
      <p className="river-tip__value">
        <strong>{fmtInt(d.value)}</strong> people <span className="river-tip__muted">· {fmtPct(d.value, slice.n)} of the class</span>
      </p>
      {desc && <p className="river-tip__desc">{desc}.</p>}
      {parts && parts.length > 0 && (
        <div className="river-tip__sect">
          <p className="river-tip__h">Fields in this group</p>
          <ul className="river-tip__list">
            {parts.map(([f, v]) => <Row key={f} name={familyLabel(f)} value={v} />)}
          </ul>
        </div>
      )}
      {det && det.employers.length > 0 && (
        <div className="river-tip__sect">
          <p className="river-tip__h">Top employers</p>
          <ul className="river-tip__list">
            {det.employers.slice(0, 4).map((e) => <Row key={e.name} name={e.name} value={e.n} />)}
          </ul>
        </div>
      )}
      {det && det.titles.length > 0 && (
        <div className="river-tip__sect">
          <p className="river-tip__h">Common titles</p>
          <ul className="river-tip__list">
            {det.titles.slice(0, 3).map((e) => <Row key={e.name} name={e.name} value={e.n} />)}
          </ul>
        </div>
      )}
      {flows.length > 0 && flowStage && (
        <div className="river-tip__sect">
          <p className="river-tip__h">{outs.length ? 'Went on to' : 'Came from'} ({STAGES[flowStage]?.label ?? flowStage})</p>
          <ul className="river-tip__list">
            {flows.slice(0, 3).map((l) => {
              const fam = outs.length ? l.to : l.from;
              return <Row key={l.id} name={familyShort(fam)} value={l.value} family={fam} />;
            })}
          </ul>
        </div>
      )}
      <p className="river-tip__hint">{pinned ? 'Pinned · click again or press Esc to clear' : 'Click to pin'}</p>
    </>
  );
}

function LinkTip({ l, slice, nodeMap }: { l: RLink; slice: ViewSlice; nodeMap: Map<string, RNode> }) {
  const src = nodeMap.get(l.source);
  return (
    <>
      <p className="river-tip__value"><strong>{fmtInt(l.value)}</strong> people</p>
      <ul className="river-tip__list river-tip__route">
        <li><span><Key family={l.from} />{familyShort(l.from)}</span><span className="river-tip__muted">{STAGES[l.fromStage]?.label ?? l.fromStage}</span></li>
        <li><span><span className="river-tip__arrow" aria-hidden="true">→</span><Key family={l.to} />{familyShort(l.to)}</span><span className="river-tip__muted">{STAGES[l.toStage]?.label ?? l.toStage}</span></li>
      </ul>
      {src && (
        <p className="river-tip__muted">
          {fmtPct(l.value, src.value)} of {familyLabel(l.from)} at {(STAGES[l.fromStage]?.label ?? l.fromStage).toLowerCase()} · {fmtPct(l.value, slice.n)} of the class
        </p>
      )}
    </>
  );
}
