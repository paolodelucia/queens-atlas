/**
 * The bubble map: Natural Earth basemap (world-atlas, lazy 50m detail), one bubble per metro sized
 * by sqrt(people), greedy collision-free labels, d3-zoom pan/zoom with region presets, optional
 * flow arcs, and a nearest-bubble hover layer. Positions are projected once per width; zooming
 * only re-applies a transform (the land is a transformed <g>; bubbles, labels and arcs are drawn
 * in screen space so their sizes stay legible at every zoom).
 *
 * The view follows an "intent": a preset region, a fit to some places, or wherever the visitor
 * dragged it. Resizing re-applies a region or fit, and otherwise keeps the same place centred.
 * `target` (the view that tells the current filter's story) is applied on mount and whenever
 * `autoKey` changes, except that a view the visitor chose is kept when the target is only the
 * generic default.
 */
import { useCallback, useEffect, useEffectEvent, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react';
import { easeCubicInOut, geoPath, select, zoom, zoomIdentity } from 'd3';
import type { D3ZoomEvent, ZoomBehavior } from 'd3';
import type { Metro } from '../../data/types';
import { fmtCompact, fmtInt } from '../../lib/format';
import { prefersReducedMotion, useWidth } from './hooks';
import { ISLANDS, LAKES, RIVERS } from './lakes';
import { loadLand } from './land';
import type { LandShapes } from './land';
import {
  DEFAULT_REGION, MAX_K, REGIONS, applyTransform, arcControl, arcPath, carryTransform, centerOn, flowWidth,
  frenchQuebec, inRegion, makeFrame, mapLabels, pickNearest, placeName, project, radiusScale, regionTransform,
  shareText, sizeLegendLayout, sizeLegendValues, targetTransform, targetWithSelection, zoomRadiusFactor,
} from './model';
import type { FlowArc, MapFrame, MapTarget, MetroRow, Pt, RegionId, Transform } from './model';

export interface MapHandle {
  zoomToRegion(id: RegionId): void;
  zoomToCountry(iso2: string): void;
  /**
   * Bring a selected metro into view: zoom to Ontario & Québec when it's there and the map is
   * zoomed out past that region; otherwise pan only if it's off-screen.
   */
  revealMetro(id: string): void;
}

interface Props {
  rows: MetroRow[];
  /** People in the shown filter (denominator for shares). */
  total: number;
  /** "Computer Science alumni (Undergrad)": used in tooltips and the accessible name. */
  who: string;
  flows: FlowArc[] | null;
  selectedId: string | null;
  onSelect(id: string | null): void;
  /** Every metro (for country zoom and arcs to metros outside the current filter). */
  allMetros: Metro[];
  /** Display names that tell same-named places apart ("London, Ont."), keyed by metro id. */
  names: Map<string, string>;
  /** The view that tells the current story (see the file comment). */
  target: MapTarget;
  /** Re-apply `target` when this changes (filter and moves). */
  autoKey: string;
  /** Extra toolbar controls (Moves / Table toggles, Copy link). */
  actions?: ReactNode;
  /** The floor for counts naming a place (meta.k.named): used in the empty-map and legend copy. */
  floor?: number;
  ref?: Ref<MapHandle>;
}

type Intent = MapTarget | { kind: 'free' };

/** Zoom level where the 50m basemap replaces the 110m one. */
const DETAIL_K = 3.5;
const LABEL_FONT = 12;

type Hover =
  | { kind: 'metro'; id: string; x: number; y: number; viaFocus?: boolean }
  | { kind: 'flow'; key: string; x: number; y: number };

interface ScreenBubble { id: string; x: number; y: number; r: number; row: MetroRow }

const REGION_SHORT: Partial<Record<RegionId, string>> = { 'north-america': 'N. America', 'ontario-quebec': 'Ont. & Qué.' };

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Wheel zooms only with Ctrl/⌘ (trackpad pinch sends ctrlKey), so the page still scrolls past the map. */
function zoomFilter(event: Event): boolean {
  const e = event as MouseEvent & TouchEvent & WheelEvent;
  if (e.type === 'wheel') return e.ctrlKey || e.metaKey;
  if (e.type === 'dblclick') return true;
  return !e.ctrlKey && !e.button;
}

function wheelDelta(event: WheelEvent): number {
  const base = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
  const pinch = event.ctrlKey && Math.abs(event.deltaY) < 40;
  return -event.deltaY * base * (pinch ? 8 : 1.4);
}

const FALLBACK_WIDTH = 960;

export default function DiasporaMap({
  rows, total, who, flows, selectedId, onSelect, allMetros, names, target, autoKey, actions, floor = 10, ref,
}: Props) {
  const uid = useId().replace(/:/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useWidth(wrapRef, FALLBACK_WIDTH);
  const frame = useMemo(() => makeFrame(width), [width]);
  const { height } = frame;
  const metroById = useMemo(() => new Map(allMetros.map((m) => [m.id, m])), [allMetros]);
  const nameOf = useCallback((m: Metro) => names.get(m.id) ?? frenchQuebec(m.name), [names]);

  // ── view intent & zoom ──
  const [initial] = useState(() => {
    const sel = selectedId ? metroById.get(selectedId) ?? null : null;
    const intent: Intent = targetWithSelection(target, sel);
    return { intent, t: targetTransform(makeFrame(FALLBACK_WIDTH), intent) };
  });
  const intentRef = useRef<Intent>(initial.intent);
  /** The visitor moved the map themselves since the last automatic view. */
  const userRef = useRef(false);
  const [activeRegion, setActiveRegion] = useState<RegionId | null>(initial.intent.kind === 'region' ? initial.intent.id : null);
  const setIntent = useCallback((next: Intent, user: boolean) => {
    intentRef.current = next;
    userRef.current = user;
    setActiveRegion(next.kind === 'region' ? next.id : null);
  }, []);

  const [t, setT] = useState<Transform>(initial.t);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const live = useRef<{ t: Transform; frame: MapFrame | null }>({ t: initial.t, frame: null });
  const raf = useRef(0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const commit = () => {
      raf.current = 0;
      setT(live.current.t);
    };
    const z = zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [frame.width, frame.height]])
      .translateExtent([[0, 0], [frame.width, frame.height]])
      .scaleExtent([1, MAX_K])
      .clickDistance(4)
      .filter(zoomFilter)
      .wheelDelta(wheelDelta)
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        live.current = { t: { k: e.transform.k, x: e.transform.x, y: e.transform.y }, frame };
        if (e.sourceEvent) {
          // A drag, pinch or wheel: the visitor now owns the view.
          if (intentRef.current.kind !== 'free') {
            intentRef.current = { kind: 'free' };
            setActiveRegion(null);
          }
          userRef.current = true;
        }
        if (!raf.current) raf.current = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(commit) : (setTimeout(commit, 16) as unknown as number);
      });
    zoomRef.current = z;
    const sel = select(svg);
    sel.call(z);
    // A region or fit is re-fitted to the new size; a free view keeps the same place centred.
    const prev = live.current;
    const intent = intentRef.current;
    const next = intent.kind !== 'free'
      ? targetTransform(frame, intent)
      : prev.frame && prev.frame !== frame ? carryTransform(prev.frame, prev.t, frame) : prev.t;
    sel.call(z.transform, zoomIdentity.translate(next.x, next.y).scale(next.k));
    return () => {
      sel.interrupt();
      sel.on('.zoom', null);
    };
  }, [frame]);

  useEffect(() => () => {
    // Reset too: StrictMode re-runs effects, and a stale id would block every later frame.
    if (raf.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const zoomTo = useCallback((next: Transform) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    const tt = zoomIdentity.translate(next.x, next.y).scale(next.k);
    const sel = select(svg);
    if (prefersReducedMotion()) sel.interrupt().call(z.transform, tt);
    else sel.transition().duration(850).ease(easeCubicInOut).call(z.transform, tt);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    setIntent({ kind: 'free' }, true);
    const sel = select(svg);
    if (prefersReducedMotion()) sel.call(z.scaleBy, factor);
    else sel.transition().duration(300).call(z.scaleBy, factor);
  }, [setIntent]);

  const goRegion = useCallback((id: RegionId) => {
    setIntent({ kind: 'region', id }, true);
    zoomTo(regionTransform(frame, id));
  }, [frame, setIntent, zoomTo]);

  // Re-frame for a new filter / moves setting (not on mount: the initial intent already did).
  const applyTarget = useEffectEvent(() => {
    if (userRef.current && target.kind === 'region' && target.id === DEFAULT_REGION) return;
    setIntent(target, false);
    zoomTo(targetTransform(frame, target));
  });
  const seenKey = useRef(autoKey);
  useEffect(() => {
    if (seenKey.current === autoKey) return;
    seenKey.current = autoKey;
    applyTarget();
  }, [autoKey]);

  const resetView = () => {
    setIntent(target, false);
    zoomTo(targetTransform(frame, target));
    onSelect(null);
  };

  useImperativeHandle(ref, () => ({
    zoomToRegion: goRegion,
    zoomToCountry(iso2: string) {
      const points = allMetros.filter((m) => m.country === iso2).map((m): [number, number] => [m.lon, m.lat]);
      if (!points.length) return;
      const fit: MapTarget = { kind: 'fit', points };
      setIntent(fit, true);
      zoomTo(targetTransform(frame, fit));
    },
    revealMetro(id: string) {
      const m = metroById.get(id);
      const p = m && project(frame, m.lon, m.lat);
      if (!m || !p) return;
      const cur = live.current.t;
      if (inRegion(m.lon, m.lat, 'ontario-quebec')) {
        const oq = regionTransform(frame, 'ontario-quebec');
        if (cur.k < oq.k * 0.8) {
          setIntent({ kind: 'region', id: 'ontario-quebec' }, true);
          zoomTo(oq);
          return;
        }
      }
      const s = applyTransform(cur, p);
      const margin = 40;
      if (s.x > margin && s.x < frame.width - margin && s.y > margin && s.y < frame.height - margin) return;
      setIntent({ kind: 'free' }, true);
      zoomTo(centerOn(p, Math.max(cur.k, 3), frame.width, frame.height));
    },
  }), [goRegion, allMetros, frame, metroById, setIntent, zoomTo]);

  // ── basemap ──
  const [land110, setLand110] = useState<LandShapes | null>(null);
  const [land50, setLand50] = useState<LandShapes | null>(null);
  const [landFailed, setLandFailed] = useState(false);
  const wantDetail = t.k >= DETAIL_K;

  useEffect(() => {
    let alive = true;
    loadLand('110m').then((s) => alive && setLand110(s), () => alive && setLandFailed(true));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!wantDetail || land50) return;
    let alive = true;
    // Detail is a nice-to-have: if it fails, the 110m map stays up.
    loadLand('50m').then((s) => alive && setLand50(s), () => undefined);
    return () => { alive = false; };
  }, [wantDetail, land50]);

  const path = useMemo(() => geoPath(frame.projection).digits(2), [frame]);
  const water = useMemo(() => ({ lakes: path(LAKES) ?? '', islands: path(ISLANDS) ?? '', rivers: path(RIVERS) ?? '' }), [path]);
  const paths110 = useMemo(() => land110 && { land: path(land110.land) ?? '', borders: path(land110.borders) ?? '' }, [land110, path]);
  const paths50 = useMemo(() => land50 && { land: path(land50.land) ?? '', borders: path(land50.borders) ?? '' }, [land50, path]);
  const landPaths = wantDetail && paths50 ? paths50 : paths110;

  // ── bubbles (largest first, so smaller ones paint on top) ──
  const maxN = rows[0]?.n ?? 0;
  const rOf = useMemo(() => radiusScale(maxN, width), [maxN, width]);
  const base = useMemo(() => rows
    .map((row) => ({ row, p: project(frame, row.metro.lon, row.metro.lat) }))
    .filter((b): b is { row: MetroRow; p: Pt } => !!b.p), [rows, frame]);
  const zf = zoomRadiusFactor(t.k);
  const bubbles: ScreenBubble[] = useMemo(() => base.map(({ row, p }) => ({
    id: row.metro.id,
    x: p.x * t.k + t.x,
    y: p.y * t.k + t.y,
    r: rOf(row.n) * zf,
    row,
  })), [base, t, rOf, zf]);
  const bubbleById = useMemo(() => new Map(bubbles.map((b) => [b.id, b])), [bubbles]);
  // Accessible names: built once per filter, not on every zoom frame.
  const ariaNames = useMemo(() => new Map(rows.map((r, i) => [
    r.metro.id,
    `${frenchQuebec(r.metro.name)}, ${placeName(r.metro)}: ${fmtInt(r.n)} people, ${shareText(r.n, total)} of ${who} (${i + 1} of ${rows.length})`,
  ])), [rows, total, who]);
  const labelText = useMemo(() => new Map(rows.map((r) => [r.metro.id, nameOf(r.metro)])), [rows, nameOf]);

  // ── roving focus: one Tab stop for the bubbles, arrow keys move between them ──
  const [roving, setRoving] = useState<{ id: string | null; sel: string | null }>({ id: selectedId, sel: selectedId });
  if (roving.sel !== selectedId) setRoving({ id: selectedId ?? roving.id, sel: selectedId });
  const tabId = roving.id && bubbleById.has(roving.id) ? roving.id : bubbles[0]?.id ?? null;

  const focusBubble = (id: string) => {
    const el = [...(svgRef.current?.querySelectorAll<SVGCircleElement>('circle.dsp-bubble') ?? [])].find((c) => c.dataset.metro === id);
    el?.focus();
  };

  // ── labels ──
  const labels = useMemo(() => mapLabels(
    bubbles.map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r, n: b.row.n, text: `${labelText.get(b.id) ?? b.row.metro.name} ${fmtCompact(b.row.n)}` })),
    { width, height, k: t.k, selectedId, fontSize: LABEL_FONT },
  ), [bubbles, labelText, width, height, t.k, selectedId]);

  // ── flows ──
  const flowGeo = useMemo(() => (flows ?? []).map((f) => {
    const p0 = project(frame, f.from.lon, f.from.lat);
    const p1 = project(frame, f.to.lon, f.to.lat);
    return p0 && p1 ? { f, p0, p1, c: arcControl(p0, p1, frame) } : null;
  }).filter((g): g is { f: FlowArc; p0: Pt; p1: Pt; c: Pt } => !!g), [flows, frame]);
  const maxFlow = flowGeo[0]?.f.n ?? 0;
  const arcs = useMemo(() => flowGeo.map(({ f, p0, p1, c }) => {
    const s0 = applyTransform(t, p0);
    const s1 = applyTransform(t, p1);
    // Moves a few pixels long are unreadable knots at this zoom; they appear as you zoom in.
    if (Math.hypot(s1.x - s0.x, s1.y - s0.y) < 14) return null;
    const sc = applyTransform(t, c);
    const w = flowWidth(f.n, maxFlow);
    const rTo = bubbleById.get(f.to.id)?.r ?? 2;
    const rFrom = bubbleById.get(f.from.id)?.r ?? 2;
    const head = Math.max(6, w * 1.1 + 4);
    const tip = arcPath(s0, sc, s1, rFrom * 0.5, rTo + 2);
    const body = arcPath(s0, sc, s1, rFrom * 0.5, rTo + 2 + head * 0.75);
    if (!tip || !body) return null;
    // Arrowhead: a triangle at the trimmed end, along the end tangent.
    const ux = tip.end.x - tip.control.x;
    const uy = tip.end.y - tip.control.y;
    const ul = Math.hypot(ux, uy) || 1;
    const dx = ux / ul;
    const dy = uy / ul;
    const bx = tip.end.x - dx * head;
    const by = tip.end.y - dy * head;
    const hw = head * 0.55;
    const arrow = `M${tip.end.x.toFixed(1)},${tip.end.y.toFixed(1)}L${(bx - dy * hw).toFixed(1)},${(by + dx * hw).toFixed(1)}L${(bx + dy * hw).toFixed(1)},${(by - dx * hw).toFixed(1)}Z`;
    return { f, w, d: body.d, hit: tip.d, arrow, start: s0, end: tip.end };
  }).filter((a): a is NonNullable<typeof a> => !!a), [flowGeo, t, maxFlow, bubbleById]);

  // ── hover / select ──
  const [hover, setHover] = useState<Hover | null>(null);
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = rect.width > 0 ? width / rect.width : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sx };
  };
  const hitAt = (x: number, y: number, touch: boolean) => pickNearest(bubbles, x, y, { minHit: touch ? 16 : 12 });

  const hoverAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = toLocal(e);
    const hit = hitAt(x, y, e.pointerType === 'touch');
    if (hit) { setHover({ kind: 'metro', id: hit.id, x, y }); return; }
    const flowKey = (e.target as Element).getAttribute?.('data-flow');
    if (flowKey) { setHover({ kind: 'flow', key: flowKey, x, y }); return; }
    if (hover) setHover(null);
  };
  // No tooltip while dragging the map; a tap (touch/pen) shows it straight away.
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.buttons) { if (hover) setHover(null); return; }
    hoverAt(e);
  };

  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const { x, y } = toLocal(e);
    const hit = hitAt(x, y, false);
    // Selecting is idempotent (a double-click zooms in; it shouldn't also deselect).
    if (hit) { if (hit.id !== selectedId) onSelect(hit.id); return; }
    if ((e.target as Element).getAttribute?.('data-flow')) return;
    if (selectedId) onSelect(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setHover(null);
      if (selectedId) { onSelect(null); e.stopPropagation(); }
    }
  };

  /** Keyboard focus on an off-screen bubble pans to it (the visitor now owns the view). */
  const reveal = (id: string) => {
    const b = bubbleById.get(id);
    if (!b || (b.x > 0 && b.x < width && b.y > 0 && b.y < height)) return;
    const m = metroById.get(id);
    const p = m && project(frame, m.lon, m.lat);
    if (!p) return;
    setIntent({ kind: 'free' }, true);
    zoomTo(centerOn(p, t.k, width, height));
  };

  const onBubbleKey = (e: KeyboardEvent<SVGCircleElement>, i: number, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); return; }
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(bubbles.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = bubbles.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const next = bubbles[j].id;
    setRoving((r) => ({ ...r, id: next }));
    focusBubble(next);
  };

  // Cooperative gestures: a plain wheel scrolls the page and shows a hint instead of hijacking it.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { setHint(false); return; }
      setHint(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHint(false), 1400);
    };
    svg.addEventListener('wheel', onWheel, { passive: true });
    return () => { svg.removeEventListener('wheel', onWheel); window.clearTimeout(timer); };
  }, []);

  const hovered = hover?.kind === 'metro' ? bubbleById.get(hover.id) ?? null : null;
  // A focused bubble's tooltip follows the bubble (it may be panning into view); a hovered one the pointer.
  const tipAt = hovered && hover?.kind === 'metro'
    ? hover.viaFocus ? { x: hovered.x, y: hovered.y - hovered.r } : { x: hover.x, y: hover.y }
    : null;
  const hoveredArc = hover?.kind === 'flow' ? arcs.find((a) => a.f.key === hover.key) ?? null : null;
  const selected = selectedId ? bubbleById.get(selectedId) ?? null : null;
  const selectedMetro = selectedId ? metroById.get(selectedId) ?? null : null;
  const selectedPt = useMemo(() => {
    if (selected || !selectedMetro) return null;
    const p = project(frame, selectedMetro.lon, selectedMetro.lat);
    return p ? applyTransform(t, p) : null;
  }, [selected, selectedMetro, frame, t]);
  const focusId = hoveredArc ? null : selectedId;
  // Legend circles are drawn at true size, so cap the largest at ~22px (pick smaller round values when zoomed in).
  const legendVals = useMemo(() => {
    const rMax = rOf(maxN) * zf;
    const cap = rMax > 22 ? maxN * (22 / rMax) ** 2 : maxN;
    return sizeLegendValues(cap);
  }, [maxN, rOf, zf]);
  const legendLayout = useMemo(() => sizeLegendLayout(legendVals.map((v) => ({ v, r: rOf(v) * zf }))), [legendVals, rOf, zf]);

  return (
    <div className="dsp-map" onKeyDown={onKeyDown}>
      <div className="dsp-map__toolbar">
        <div className="dsp-presets" role="group" aria-label="Zoom to region">
          {REGIONS.map((r) => (
            <button key={r.id} type="button" className="dsp-chip" aria-pressed={activeRegion === r.id} onClick={() => goRegion(r.id)}>
              {REGION_SHORT[r.id]
                ? <><span className="dsp-long">{r.label}</span><span className="dsp-short">{REGION_SHORT[r.id]}</span></>
                : r.label}
            </button>
          ))}
        </div>
        {actions && <div className="dsp-map__actions">{actions}</div>}
      </div>

      <div className="dsp-map__stage" ref={wrapRef}>
        <svg
          ref={svgRef}
          className={`dsp-svg${flows ? ' has-flows' : ''}`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`Map of where ${who} live now: ${fmtInt(rows.length)} metro areas, bubble area proportional to people. The table view lists the same numbers.`}
          aria-describedby={rows.length ? `${uid}-keys` : undefined}
          data-k={t.k.toFixed(3)}
          onPointerMove={onPointerMove}
          onPointerDown={(e) => { if (e.pointerType !== 'mouse') hoverAt(e); }}
          onPointerLeave={() => setHover((h) => (h && h.kind === 'metro' && h.viaFocus ? h : null))}
          onClick={onClick}
        >
          <defs>
            <clipPath id={`${uid}-clip`}><rect width={width} height={height} /></clipPath>
            {arcs.map((a, i) => (
              <linearGradient key={a.f.key} id={`${uid}-g${i}`} gradientUnits="userSpaceOnUse" x1={a.start.x} y1={a.start.y} x2={a.end.x} y2={a.end.y}>
                <stop offset="0" className="dsp-flow-stop0" />
                <stop offset="1" className="dsp-flow-stop1" />
              </linearGradient>
            ))}
          </defs>
          <rect className="dsp-water" width={width} height={height} />
          <g aria-hidden="true" clipPath={`url(#${uid}-clip)`}>
            <g transform={`translate(${t.x},${t.y}) scale(${t.k})`} className={`dsp-land-layer${landPaths ? ' is-ready' : ''}`}>
              {landPaths && <path className="dsp-land" d={landPaths.land} />}
              {landPaths && <path className="dsp-lake" d={water.lakes} />}
              {landPaths && <path className="dsp-island" d={water.islands} />}
              {landPaths && <path className="dsp-river" d={water.rivers} />}
              {landPaths && <path className="dsp-border" d={landPaths.borders} />}
            </g>
          </g>

          <g className="dsp-bubbles">
            {bubbles.map((b, i) => (
              <circle
                key={b.id}
                className={`dsp-bubble${b.id === selectedId ? ' is-selected' : ''}${hovered?.id === b.id ? ' is-hovered' : ''}`}
                data-metro={b.id}
                cx={b.x}
                cy={b.y}
                r={b.r}
                style={{ r: b.r } as CSSProperties}
                tabIndex={b.id === tabId ? 0 : -1}
                role="button"
                aria-label={ariaNames.get(b.id)}
                aria-pressed={b.id === selectedId}
                onFocus={() => {
                  reveal(b.id);
                  if (roving.id !== b.id) setRoving((r) => ({ ...r, id: b.id }));
                  setHover({ kind: 'metro', id: b.id, x: b.x, y: b.y, viaFocus: true });
                }}
                onBlur={() => setHover((h) => (h?.kind === 'metro' && h.id === b.id ? null : h))}
                onKeyDown={(e) => onBubbleKey(e, i, b.id)}
              />
            ))}
          </g>

          {arcs.length > 0 && (
            <g className={`dsp-flows${hoveredArc || focusId ? ' has-focus' : ''}`}>
              {arcs.map((a, i) => {
                const on = hoveredArc ? hoveredArc === a : focusId ? a.f.from.id === focusId || a.f.to.id === focusId : true;
                return (
                  <g key={a.f.key} className={`dsp-flow${on ? ' is-on' : ''}`}>
                    <path className="dsp-flow__line" d={a.d} style={{ stroke: `url(#${uid}-g${i})`, strokeWidth: a.w }} />
                    <path className="dsp-flow__head" d={a.arrow} />
                    <path className="dsp-flow__hit" d={a.hit} data-flow={a.f.key} style={{ strokeWidth: Math.max(12, a.w + 8) }} />
                  </g>
                );
              })}
            </g>
          )}

          {(selected || hovered) && (
            <g className="dsp-rings" aria-hidden="true">
              {selected && <circle className="dsp-ring is-selected" cx={selected.x} cy={selected.y} r={selected.r + 2} />}
              {hovered && hovered !== selected && <circle className="dsp-ring" cx={hovered.x} cy={hovered.y} r={hovered.r + 1.5} />}
            </g>
          )}
          {selectedPt && <circle className="dsp-ring is-selected is-absent" cx={selectedPt.x} cy={selectedPt.y} r={4} aria-hidden="true" />}

          <g className="dsp-labels" aria-hidden="true">
            {labels.map((l) => l.leader && (
              <line key={`${l.id}-leader`} className="dsp-leader" x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} />
            ))}
            {labels.map((l) => {
              const b = bubbleById.get(l.id);
              if (!b) return null;
              return (
                <text key={l.id} x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="central" className={`dsp-label${l.id === selectedId ? ' is-selected' : ''}`} data-label={l.id}>
                  {labelText.get(l.id) ?? b.row.metro.name}
                  <tspan className="dsp-label__n" dx={4}>{fmtCompact(b.row.n)}</tspan>
                </text>
              );
            })}
          </g>
        </svg>
        {rows.length > 0 && (
          <p id={`${uid}-keys`} className="sr-only">Arrow keys move between places, largest first. Enter shows details.</p>
        )}

        <div className="dsp-zoom" role="group" aria-label="Zoom">
          <button type="button" className="dsp-zoom__btn" onClick={() => zoomBy(2)} aria-label="Zoom in" disabled={t.k >= MAX_K - 0.01}>+</button>
          <button type="button" className="dsp-zoom__btn" onClick={() => zoomBy(0.5)} aria-label="Zoom out" disabled={t.k <= 1.001}>−</button>
          <button type="button" className="dsp-zoom__btn" onClick={resetView} aria-label="Reset map">⟲</button>
        </div>

        {rows.length === 0 && (
          <div className="dsp-empty" role="note">
            No single city has {floor} or more {who}, so there are no bubbles to draw. They still count in the
            country totals below.
          </div>
        )}
        {hint && <div className="dsp-hint" aria-hidden="true">Hold {isMac() ? '⌘' : 'Ctrl'} and scroll to zoom the map</div>}
        {landFailed && <div className="dsp-landfail">Basemap couldn’t load; the bubbles are still accurate.</div>}

        {hovered && tipAt && (
          <Tooltip x={tipAt.x} y={tipAt.y} width={width} height={height}>
            <div className="dsp-tip__value">{fmtInt(hovered.row.n)} <span>people</span></div>
            <div className="dsp-tip__title">{labelText.get(hovered.id) ?? hovered.row.metro.name}</div>
            <div className="dsp-tip__sub">{placeName(hovered.row.metro)}</div>
            <div className="dsp-tip__share">{shareText(hovered.row.n, total)} of {who} with a known location</div>
          </Tooltip>
        )}
        {hoveredArc && hover && (
          <Tooltip x={hover.x} y={hover.y} width={width} height={height}>
            <div className="dsp-tip__value">{fmtInt(hoveredArc.f.n)} <span>people</span></div>
            <div className="dsp-tip__title">
              started in {nameOf(hoveredArc.f.from)}, now live in {nameOf(hoveredArc.f.to)}
            </div>
            <div className="dsp-tip__sub">First job → home today (all alumni)</div>
          </Tooltip>
        )}
      </div>

      <div className="dsp-legend">
        {legendVals.length > 0 && (
          <figure className="dsp-legend__size" aria-label="Bubble size legend">
            <svg width={legendLayout.width} height={legendLayout.height} aria-hidden="true">
              {legendLayout.items.map((it) => (
                <g key={it.v}>
                  <circle className="dsp-legend__circle" cx={it.cx} cy={it.cy} r={it.r} />
                  <text className="dsp-legend__text" x={it.cx} y={legendLayout.height - 2} textAnchor="middle">{fmtCompact(it.v)}</text>
                </g>
              ))}
            </svg>
            <figcaption>Bubble area = people living there now. Places with fewer than {floor} aren’t shown.</figcaption>
          </figure>
        )}
        {flows && (
          <figure className="dsp-legend__flow" aria-label="Moves legend">
            <svg width="64" height="22" aria-hidden="true">
              <defs>
                <linearGradient id={`${uid}-lg`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" className="dsp-flow-stop0" />
                  <stop offset="1" className="dsp-flow-stop1" />
                </linearGradient>
              </defs>
              <path d="M4,18 Q30,0 50,12" fill="none" style={{ stroke: `url(#${uid}-lg)`, strokeWidth: 3 }} />
              <path className="dsp-flow__head" d="M60,17 L47.5,15.4 L52.5,8.6 Z" />
            </svg>
            <figcaption>Moves: first job → where people live now, all alumni. Line width = people ({fmtInt(maxFlow)} at most).</figcaption>
          </figure>
        )}
        <p className="dsp-legend__help">
          <span className="dsp-click">Drag to pan · {isMac() ? '⌘' : 'Ctrl'} + scroll or pinch to zoom · click a bubble for details</span>
          <span className="dsp-tap">Drag to pan · pinch to zoom · tap a bubble for details</span>
        </p>
      </div>
    </div>
  );
}

function Tooltip({ x, y, width, height, children }: { x: number; y: number; width: number; height: number; children: ReactNode }) {
  // Flip to the left half / above when close to the right / bottom edges.
  const left = x > width * 0.62;
  const above = y > height * 0.55;
  const style = {
    left: x,
    top: y,
    transform: `translate(${left ? 'calc(-100% - 14px)' : '14px'}, ${above ? 'calc(-100% - 10px)' : '10px'})`,
  };
  return <div className="dsp-tip" aria-hidden="true" style={style}>{children}</div>;
}
