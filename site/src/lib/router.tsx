/**
 * A ~60-line router: path routes plus query-string state, on the History API.
 * Views keep their filters in the URL (useQueryState) so every view is shareable as a link.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface Location { path: string; search: string }

function readLocation(): Location {
  let path = window.location.pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  return { path: path.replace(/\/+$/, '') || '/', search: window.location.search };
}

const RouterContext = createContext<{ loc: Location; navigate: (to: string, opts?: { replace?: boolean }) => void } | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(readLocation);

  useEffect(() => {
    const onPop = () => setLoc(readLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = to.startsWith('/') ? BASE + to : to;
    if (opts?.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    const next = readLocation();
    setLoc(next);
    if (!opts?.replace && !to.includes('#')) window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo(() => ({ loc, navigate }), [loc, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter outside RouterProvider');
  return ctx;
}

/** In-app link: plain <a href> (works without JS, middle-click opens a tab) with SPA navigation. */
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={BASE + to} {...rest} onClick={onClick}>{children}</a>;
}

/**
 * One query-string parameter as React state. Writes use replaceState so filter tweaks
 * don't flood the back button. `parse` guards against hand-edited URLs: return the
 * fallback for anything invalid.
 */
export function useQueryState<T extends string>(key: string, fallback: T, parse?: (raw: string) => T | null): [T, (v: T) => void] {
  const { loc, navigate } = useRouter();
  const raw = new URLSearchParams(loc.search).get(key);
  const value = raw === null ? fallback : (parse ? parse(raw) ?? fallback : (raw as T));

  const set = useCallback((v: T) => {
    const params = new URLSearchParams(window.location.search);
    if (v === fallback) params.delete(key); else params.set(key, v);
    const qs = params.toString();
    navigate(`${readLocation().path}${qs ? `?${qs}` : ''}`, { replace: true });
  }, [key, fallback, navigate]);

  return [value, set];
}
