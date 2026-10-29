import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { below, useMediaQuery } from '../../components/controls';

/** Phones: the list-first layout (the same 640px breakpoint the shared controls use). */
export const PHONE_QUERY = below(640);

/** True on phone-width viewports (false where matchMedia is missing, e.g. tests: the wide layout). */
export function useNarrow(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

/** An element's content width in px, tracked with ResizeObserver; `fallback` until it is measured. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cw = Math.round(entries[0]?.contentRect.width ?? 0);
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w || fallback;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scroll behaviour that respects reduced motion. */
export function smooth(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
