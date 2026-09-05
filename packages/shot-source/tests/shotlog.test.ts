import { describe, expect, it } from "vitest";
import { ShotLog, createMemoryStore, type ShotLogEntry } from "../src/log/ShotLog";
import { enrichShot } from "../src/enrich";
import type { RawShotEvent } from "../src/types";

function entry(sessionId: string, timestamp: number): ShotLogEntry {
  const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp };
  return {
    sessionId,
    timestamp,
    strokeNumber: 1,
    isPutt: false,
    penalty: null,
    raw,
    shot: enrichShot(raw, "7i"),
  };
}

describe("createMemoryStore", () => {
  it("round-trips get/set like localStorage", () => {
    const store = createMemoryStore();
    expect(store.getItem("k")).toBeNull();
    store.setItem("k", "v");
    expect(store.getItem("k")).toBe("v");
  });
});

describe("ShotLog", () => {
  it("is empty for an unknown session", () => {
    const log = new ShotLog(createMemoryStore());
    expect(log.getSession("nope")).toEqual([]);
  });

  it("appends entries and retrieves only the requested session, in order", () => {
    const log = new ShotLog(createMemoryStore());
    log.append(entry("s1", 1));
    log.append(entry("s2", 1));
    log.append(entry("s1", 2));

    const session = log.getSession("s1");
    expect(session).toHaveLength(2);
    expect(session.map((e) => e.timestamp)).toEqual([1, 2]);
  });

  it("lists distinct session ids", () => {
    const log = new ShotLog(createMemoryStore());
    log.append(entry("s1", 1));
    log.append(entry("s1", 2));
    log.append(entry("s2", 1));
    expect(log.listSessionIds().sort()).toEqual(["s1", "s2"]);
  });

  it("persists across ShotLog instances sharing the same store", () => {
    const store = createMemoryStore();
    new ShotLog(store).append(entry("s1", 1));
    const second = new ShotLog(store);
    expect(second.getSession("s1")).toHaveLength(1);
  });

  it("carries the rest position and surfaces when the caller provides them", () => {
    const log = new ShotLog(createMemoryStore());
    log.append({ ...entry("s1", 1), rest: { x: 3, y: 150 }, landingSurface: "fairway", restSurface: "fairway" });
    const [saved] = log.getSession("s1");
    expect(saved?.rest).toEqual({ x: 3, y: 150 });
    expect(saved?.restSurface).toBe("fairway");
  });

  it("records a putt stroke without ball-flight fields", () => {
    const log = new ShotLog(createMemoryStore());
    log.append({
      sessionId: "s1",
      timestamp: 1,
      strokeNumber: 4,
      isPutt: true,
      penalty: null,
      puttDistanceBeforeYds: 6,
      puttDistanceAfterYds: 0,
      holed: true,
    });
    const [saved] = log.getSession("s1");
    expect(saved?.isPutt).toBe(true);
    expect(saved?.holed).toBe(true);
    expect(saved?.raw).toBeUndefined();
  });

  it("records a penalty on a stroke", () => {
    const log = new ShotLog(createMemoryStore());
    log.append({ ...entry("s1", 1), strokeNumber: 2, penalty: "water" });
    const [saved] = log.getSession("s1");
    expect(saved?.penalty).toBe("water");
  });
});
