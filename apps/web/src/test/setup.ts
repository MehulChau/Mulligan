import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom's built-in localStorage, on Node 22+, tries to defer to Node's own
// native webstorage backend -- which needs a --localstorage-file flag to
// actually work and otherwise leaves every Storage method undefined. A
// small in-memory polyfill sidesteps that Node/jsdom interaction entirely
// (and doesn't depend on a CLI flag no one would think to look for in a
// CI config) rather than chasing version pins for two fast-moving tools.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

Object.defineProperty(window, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true });

// jsdom has no real <canvas> 2D context (getContext('2d') returns null,
// "Not implemented" warning) -- fine for tests that don't care about
// HoleCanvas's own effect running at all, but the round-flow integration
// tests need that effect to actually run so its skip-animation fast path
// (which synchronously calls onShotSettled, no requestAnimationFrame
// ticking needed) can drive SHOT_SETTLED the same way a real browser with
// "Skip animation" checked would. A Proxy that accepts any property
// get/set and hands back a no-op function for anything callable is enough
// -- these tests never assert on pixels, only on the state transitions
// the draw calls trigger as a side effect of running at all.
function createFakeContext2D(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  const specialReturns: Record<string, unknown> = {
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop: string) {
      if (prop in specialReturns) return specialReturns[prop];
      if (prop in state) return state[prop];
      return () => {};
    },
    set(_target, prop: string, value) {
      state[prop] = value;
      return true;
    },
  });
}
HTMLCanvasElement.prototype.getContext = function (type: string) {
  return type === "2d" ? createFakeContext2D() : null;
} as typeof HTMLCanvasElement.prototype.getContext;

// jsdom doesn't implement ResizeObserver either -- HoleCanvas's effect
// reaches `new ResizeObserver(...)` right after the getContext('2d') check
// above, so this is only needed because that check now passes.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver = FakeResizeObserver;

// jsdom doesn't implement matchMedia at all -- usePrefersReducedMotion
// (motion.ts) calls it unconditionally on mount. Report "no preference"
// (matches: false) for every query; nothing here needs to fire change
// events since no test exercises a live prefers-reduced-motion toggle.
window.matchMedia =
  window.matchMedia ??
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

// jsdom has no IndexedDB implementation at all -- fake-indexeddb/auto
// installs a real (if in-memory) one as the global `indexedDB`, which is
// what persistence/idb.ts actually talks to. Without this, every
// IndexedDB-touching test would silently hit idb.ts's "indexedDB is
// undefined" fallback path instead of the real read/write logic.
afterEach(() => {
  cleanup();
});
