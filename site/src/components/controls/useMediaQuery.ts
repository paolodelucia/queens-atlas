import { useCallback, useSyncExternalStore } from 'react';

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** "Narrower than `px`", written the way controls.css writes it: 640 → "(max-width: 639.98px)". */
export const below = (px: number) => `(max-width: ${px - 0.02}px)`;

/**
 * Live result of a CSS media query (re-renders when it flips). False when `query` is null or the
 * browser has no matchMedia, so controls fall back to their wide layout.
 */
export function useMediaQuery(query: string | null): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!query || !canMatch()) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => !!query && canMatch() && window.matchMedia(query).matches,
    () => false,
  );
}
