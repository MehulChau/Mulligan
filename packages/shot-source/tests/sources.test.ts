import { degToRad, metersToYards, mphToMps, rpmToRadPerSec, simulate } from "@mulligan/physics";
import { describe, expect, it } from "vitest";
import { findClub, type ClubId } from "../src/clubs";
import { PERFECT_DISPERSION } from "../src/dispersion";
import { ShotLog, createMemoryStore } from "../src/log/ShotLog";
import { ManualShotSource } from "../src/sources/ManualShotSource";
import { ReplayShotSource } from "../src/sources/ReplayShotSource";
import { SimulatedShotSource } from "../src/sources/SimulatedShotSource";
import { enrichShot } from "../src/enrich";
import type { RawShotEvent } from "../src/types";

describe("ManualShotSource", () => {
  it("throws if emit is called before start()", () => {
    const source = new ManualShotSource();
    const raw: RawShotEvent = { ballSpeedMph: 100, launchDeg: 15, timestamp: 1 };
    expect(() => source.emit(raw)).toThrow(/start/);
  });

  it("delivers emitted shots to subscribers, and stops after unsubscribe", async () => {
    const source = new ManualShotSource();
    await source.start();
    const received: RawShotEvent[] = [];
    const unsubscribe = source.onShot((shot) => received.push(shot));

    const raw: RawShotEvent = { ballSpeedMph: 100, launchDeg: 15, timestamp: 1 };
    source.emit(raw);
    expect(received).toEqual([raw]);

    unsubscribe();
    source.emit({ ...raw, timestamp: 2 });
    expect(received).toHaveLength(1); // unsubscribed listener got nothing more
  });
});

describe("SimulatedShotSource", () => {
  it("throws if hit is called before start()", () => {
    const source = new SimulatedShotSource();
    expect(() => source.hit("7i")).toThrow(/start/);
  });

  it("is deterministic for a given seed", async () => {
    const a = new SimulatedShotSource(PERFECT_DISPERSION, 123);
    const b = new SimulatedShotSource(PERFECT_DISPERSION, 123);
    await a.start();
    await b.start();
    expect(a.hit("driver", 1)).toEqual(b.hit("driver", 1));
  });

  it("PERFECT dispersion lands within 0.1 yards of the club's golden carry", async () => {
    const source = new SimulatedShotSource(PERFECT_DISPERSION, 1);
    await source.start();

    const cases: Array<[ClubId, number]> = [
      ["driver", 224.44],
      ["7i", 148.70],
      ["lw", 77.18],
    ];

    for (const [clubId, goldenCarryYds] of cases) {
      const raw = source.hit(clubId, 1);
      const enriched = enrichShot(raw, clubId);
      const trajectory = simulate({
        ballSpeed: mphToMps(enriched.ballSpeedMph),
        launchAngle: degToRad(enriched.launchDeg),
        spinRate: rpmToRadPerSec(enriched.spinRpm),
        spinAxis: degToRad(enriched.spinAxisDeg),
        startLine: degToRad(enriched.startLineDeg),
      });
      expect(Math.abs(metersToYards(trajectory.carry) - goldenCarryYds)).toBeLessThanOrEqual(0.1);
    }
  });

  it("notifies subscribers on hit", async () => {
    const source = new SimulatedShotSource();
    await source.start();
    const received: RawShotEvent[] = [];
    source.onShot((shot) => received.push(shot));
    const shot = source.hit("driver");
    expect(received).toEqual([shot]);
  });
});

describe("ReplayShotSource", () => {
  function loggedSession(sessionId: string): ShotLog {
    const log = new ShotLog(createMemoryStore());
    const club = findClub("7i");
    for (let i = 0; i < 3; i++) {
      const raw: RawShotEvent = { ballSpeedMph: club.ballSpeedMph, launchDeg: club.launchDeg, timestamp: i };
      log.append({ sessionId, timestamp: i, raw, shot: enrichShot(raw, "7i") });
    }
    return log;
  }

  it("throws if next() is called before start()", () => {
    const log = loggedSession("s1");
    const replay = new ReplayShotSource(log, "s1");
    expect(() => replay.next()).toThrow(/start/);
  });

  it("replays a logged session's raw shots in order, then returns null", async () => {
    const log = loggedSession("s1");
    const replay = new ReplayShotSource(log, "s1");
    await replay.start();

    const received: RawShotEvent[] = [];
    replay.onShot((shot) => received.push(shot));

    expect(replay.hasNext()).toBe(true);
    expect(replay.next()?.timestamp).toBe(0);
    expect(replay.next()?.timestamp).toBe(1);
    expect(replay.next()?.timestamp).toBe(2);
    expect(replay.hasNext()).toBe(false);
    expect(replay.next()).toBeNull();

    expect(received.map((s) => s.timestamp)).toEqual([0, 1, 2]);
  });

  it("only replays shots from the requested session", async () => {
    const log = loggedSession("s1");
    // append a second session's shot into the same log
    log.append({
      sessionId: "s2",
      timestamp: 99,
      raw: { ballSpeedMph: 1, launchDeg: 1, timestamp: 99 },
      shot: enrichShot({ ballSpeedMph: 1, launchDeg: 1, timestamp: 99 }, "7i"),
    });

    const replay = new ReplayShotSource(log, "s1");
    await replay.start();
    const all: RawShotEvent[] = [];
    while (replay.hasNext()) all.push(replay.next()!);
    expect(all).toHaveLength(3);
    expect(all.every((s) => s.timestamp !== 99)).toBe(true);
  });
});
