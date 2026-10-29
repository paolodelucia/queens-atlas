import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTweenedLayout } from './hooks';
import { layoutRiver } from './layout';
import type { LayoutOptions, RiverLayout } from './layout';
import { buildSankeyInput } from './model';
import { commerce, recent } from './testFixture';

const OPTS: LayoutOptions = {
  width: 1000, height: 500, nodeWidth: 12, nodePadding: 8,
  margin: { top: 50, right: 100, bottom: 10, left: 100 }, labelSpacing: 15, minGap: 130,
};
const A = layoutRiver(buildSankeyInput(commerce), OPTS, 'a');
const B = layoutRiver(buildSankeyInput(recent), OPTS, 'b');

/** requestAnimationFrame under test control: frames run only when `frame(t)` is called. */
let queue: FrameRequestCallback[] = [];
function frame(now: number) {
  const run = queue;
  queue = [];
  act(() => { for (const cb of run) cb(now); });
}

const allFinite = (l: RiverLayout) => [
  l.width, l.height,
  ...l.nodes.flatMap((d) => [d.x0, d.x1, d.y0, d.y1, d.opacity]),
  ...l.links.flatMap((d) => [d.x0, d.x1, d.y0, d.y1, d.width, d.opacity]),
].every(Number.isFinite);

beforeEach(() => {
  queue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
});
afterEach(() => vi.unstubAllGlobals());

describe('useTweenedLayout', () => {
  it('morphs to a new data key over the duration', () => {
    const { result, rerender } = renderHook(({ target, duration }) => useTweenedLayout(target, duration), {
      initialProps: { target: A, duration: 720 },
    });
    expect(result.current).toBe(A);
    rerender({ target: B, duration: 720 });
    frame(1000);
    frame(1360);
    expect(result.current).not.toBe(B);
    expect(allFinite(result.current)).toBe(true);
    frame(1720);
    expect(result.current).toBe(B);
  });

  it('finishes cleanly (no NaN) when reduced motion turns the duration to 0 mid-morph', () => {
    const { result, rerender } = renderHook(({ target, duration }) => useTweenedLayout(target, duration), {
      initialProps: { target: A, duration: 720 },
    });
    rerender({ target: B, duration: 720 });
    frame(1000);
    frame(1360); // halfway
    rerender({ target: B, duration: 0 });
    frame(1400); // first frame after the switch: now - start = 0, duration 0
    expect(allFinite(result.current)).toBe(true);
    expect(result.current).toBe(B);
    expect(queue).toHaveLength(0); // no frames left running
  });

  it('snaps when the duration is 0 from the start', () => {
    const { result, rerender } = renderHook(({ target, duration }) => useTweenedLayout(target, duration), {
      initialProps: { target: A, duration: 0 },
    });
    rerender({ target: B, duration: 0 });
    expect(result.current).toBe(B);
    expect(queue).toHaveLength(0);
  });
});
