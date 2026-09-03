import type { RawShotEvent, ShotEvent } from "../types";

/**
 * Every emitted RawShotEvent, its enriched ShotEvent, and (opaque to this
 * package) wherever the ball ended up. `rest`/`landingSurface`/
 * `restSurface` are plain, duck-typed fields so this package doesn't need
 * to depend on @mulligan/game's hole-space types to log a hole-space
 * position — the shape is owned by whoever calls append().
 */
export interface ShotLogEntry {
  sessionId: string;
  timestamp: number;
  raw: RawShotEvent;
  shot: ShotEvent;
  rest?: { x: number; y: number };
  landingSurface?: string;
  restSurface?: string;
}

/** Minimal storage seam — same shape as window.localStorage, swappable for tests/SSR. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createMemoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function defaultStore(): KeyValueStore {
  if (typeof localStorage !== "undefined") return localStorage;
  return createMemoryStore();
}

const STORAGE_KEY = "mulligan:shot-log:v1";

/**
 * Append-only shot log. Feels pointless while shots are simulated — it
 * isn't. When the Pi produces real measurements and something looks wrong,
 * this is what lets you replay that exact range session against changed
 * code without going back to the range.
 */
export class ShotLog {
  constructor(private store: KeyValueStore = defaultStore()) {}

  append(entry: ShotLogEntry): void {
    const all = this.readAll();
    all.push(entry);
    this.store.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  getSession(sessionId: string): ShotLogEntry[] {
    return this.readAll().filter((entry) => entry.sessionId === sessionId);
  }

  listSessionIds(): string[] {
    return [...new Set(this.readAll().map((entry) => entry.sessionId))];
  }

  private readAll(): ShotLogEntry[] {
    const raw = this.store.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ShotLogEntry[];
    } catch {
      return [];
    }
  }
}
