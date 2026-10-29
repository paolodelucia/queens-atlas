import '@testing-library/jest-dom/vitest';

// jsdom has no layout engine; charts measure their container with ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom doesn't implement scrolling; the router scrolls to top on navigation.
window.scrollTo = (() => {}) as typeof window.scrollTo;

// matchMedia is used for reduced-motion and colour-scheme checks.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}
