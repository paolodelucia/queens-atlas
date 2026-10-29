/**
 * Data loading: one fetch per file per page load, shared by every component that asks.
 * Files are static JSON under public/data/, so there's no invalidation to worry about.
 */
import { useEffect, useState } from 'react';
import type { DiasporaFile, InsightsFile, Meta, RiverFile, TwinFile } from './types';

export interface DataFiles {
  meta: Meta;
  river: RiverFile;
  diaspora: DiasporaFile;
  twin: TwinFile;
  insights: InsightsFile;
}
export type DataName = keyof DataFiles;

const pending = new Map<DataName, Promise<unknown>>();
/** Files already loaded, so revisiting a view renders immediately with no loading flash. */
const resolved = new Map<DataName, unknown>();

export function loadData<K extends DataName>(name: K): Promise<DataFiles[K]> {
  let p = pending.get(name) as Promise<DataFiles[K]> | undefined;
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${name}.json?v=${__DATA_VERSION__}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${name} data (${r.status})`);
      return r.json() as Promise<DataFiles[K]>;
    });
    p.then(
      (data) => resolved.set(name, data),
      // Let a failed load be retried rather than caching the rejection forever.
      () => pending.delete(name),
    );
    pending.set(name, p);
  }
  return p;
}

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error; retry: () => void }
  | { status: 'ready'; data: T };

export function useData<K extends DataName>(name: K): Loadable<DataFiles[K]> {
  const [attempt, setAttempt] = useState(0);
  const key = `${name}#${attempt}`;
  const [result, setResult] = useState<{ key: string; value: Loadable<DataFiles[K]> } | null>(null);

  useEffect(() => {
    if (resolved.has(name)) return;
    let alive = true;
    loadData(name).then(
      (data) => alive && setResult({ key, value: { status: 'ready', data } }),
      (error: Error) => alive && setResult({
        key, value: { status: 'error', error, retry: () => setAttempt((a) => a + 1) },
      }),
    );
    return () => { alive = false; };
  }, [name, key]);

  if (resolved.has(name)) return { status: 'ready', data: resolved.get(name) as DataFiles[K] };
  return result?.key === key ? result.value : { status: 'loading' };
}

/** Test hook: reset the module cache between tests. */
export function __resetDataCache() {
  pending.clear();
  resolved.clear();
}
