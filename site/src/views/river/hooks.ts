import { useEffect, useState, useSyncExternalStore } from 'react';
import { easeOutCubic, interpolateLayout } from './layout';
import type { RiverLayout } from './layout';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(cb: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener?.('change', cb);
  return () => mq.removeEventListener?.('change', cb);
}

/** Live `prefers-reduced-motion`. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Content-box width of an element, tracked with ResizeObserver (0 until first measured). */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

interface Tween { from: RiverLayout; to: RiverLayout; t: number; running: boolean }

/**
 * Morph between successive layouts. A new data `key` animates from whatever frame is on
 * screen (so a change mid-animation never jumps); a same-key change (a resize) snaps.
 * `duration` 0 (reduced motion) always snaps.
 */
export function useTweenedLayout(target: RiverLayout, duration: number): RiverLayout {
  const [tw, setTw] = useState<Tween>({ from: target, to: target, t: 1, running: false });

  // Adjust state while rendering when the target changes (React's "derived state" pattern).
  if (tw.to !== target) {
    const onScreen = tw.running ? interpolateLayout(tw.from, tw.to, easeOutCubic(tw.t)) : tw.to;
    const animate = duration > 0 && typeof requestAnimationFrame === 'function'
      && onScreen.key !== target.key && onScreen.nodes.length > 0;
    setTw({ from: animate ? onScreen : target, to: target, t: animate ? 0 : 1, running: animate });
  }

  const { from, to, running } = tw;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      // duration can drop to 0 mid-morph (reduced motion switched on): finish rather than divide by 0.
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      if (t >= 1) {
        setTw((s) => (s.to === to ? { from: to, to, t: 1, running: false } : s));
      } else {
        setTw((s) => (s.to === to ? { ...s, t } : s));
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to, running, duration]);

  if (tw.to !== target) return tw.to; // render is being re-run with the adjusted state
  return tw.running ? interpolateLayout(tw.from, tw.to, easeOutCubic(tw.t)) : tw.to;
}
