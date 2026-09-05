import type { RawShotEvent, ShotEvent } from "../types";

/**
 * Every stroke of a session, in order — ball-flight shots AND putts, since
 * this is what will eventually let a real range session be replayed
 * stroke-by-stroke, not just its ball-flight portion. `raw`/`shot` (the
 * physics-side fields) are present for a ball-flight stroke and absent for
 * a putt; `puttDistanceBeforeYds`/`puttDistanceAfterYds`/`holed` are the
 * reverse. `rest`/`landingSurface`/`restSurface` are plain, duck-typed
 * fields so this package doesn't need to depend on @mulligan/game's
 * hole-space types to log a hole-space position — the shape is owned by
 * whoever calls append().
 */
export interface ShotLogEntry {
  sessionId: string;
  timestamp: number;
  /** 1-indexed stroke count for the hole, tee shot is 1. */
  strokeNumber: number;
  isPutt: boolean;
  penalty: "water" | "out" | null;

  // Ball-flight stroke fields — present when !isPutt.
  raw?: RawShotEvent;
  shot?: ShotEvent;
  rest?: { x: number; y: number };
  landingSurface?: string;
  restSurface?: string;

  // Putt fields — present when isPutt.
  puttDistanceBeforeYds?: number;
  puttDistanceAfterYds?: number;
  holed?: boolean;
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
