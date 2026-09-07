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
    const a = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 123, fidelity: "full" });
    const b = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 123, fidelity: "full" });
    await a.start();
    await b.start();
    expect(a.hit("driver", 1)).toEqual(b.hit("driver", 1));
  });

  it("PERFECT dispersion lands within 0.1 yards of the club's golden carry", async () => {
    const source = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 1, fidelity: "full" });
    await source.start();

    // Updated post-calibration (see CLAUDE.md's Part B/Part B rework
    // sections) -- DEFAULT_AERO was fit to real Trackman data, then
    // reworked 2026-09-06 to fix a carry regression the first fit shipped
    // with (see aero.ts's doc comment).
    const cases: Array<[ClubId, number]> = [
      ["driver", 232.72],
      ["7i", 143.52],
      ["lw", 68.8],
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

  it("a partial swingFraction produces a slower, lower-spin shot than a full swing", async () => {
    const source = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 1, fidelity: "full" });
    await source.start();

    const full = source.hit("lw", 1, 1);
    const half = source.hit("lw", 2, 0.5);

    expect(half.ballSpeedMph).toBeLessThan(full.ballSpeedMph);
    expect(half.spinRpm!).toBeLessThan(full.spinRpm!);
  });

  it("defaults swingFraction to a full swing when omitted", async () => {
    const a = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 1, fidelity: "full" });
    const b = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 1, fidelity: "full" });
    await a.start();
    await b.start();
    expect(a.hit("lw", 1)).toEqual(b.hit("lw", 1, 1));
  });

  it("setDispersion takes effect on the next hit(), not the current dispersion instance retroactively", async () => {
    const noisy: typeof PERFECT_DISPERSION = { ...PERFECT_DISPERSION, startLineSigmaDeg: 50 };
    const source = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 1, fidelity: "full" });
    await source.start();

    const beforeSwitch = source.hit("driver", 1);
    expect(beforeSwitch.startLineDeg).toBe(0); // PERFECT_DISPERSION -- deterministic, no scatter

    source.setDispersion(noisy);
    const a = new SimulatedShotSource({ dispersion: noisy, seed: 1, fidelity: "full" });
    await a.start();
    a.hit("driver", 1); // burn the same rng draw the first source already consumed above
    expect(source.hit("driver", 2)).toEqual(a.hit("driver", 2));
  });

  it("notifies subscribers on hit", async () => {
    const source = new SimulatedShotSource();
    await source.start();
    const received: RawShotEvent[] = [];
    source.onShot((shot) => received.push(shot));
    const shot = source.hit("driver");
    expect(received).toEqual([shot]);
  });

  it("defaults to 'device' fidelity -- the app should never accidentally get 'full'", () => {
    const source = new SimulatedShotSource();
    expect(source.fidelity).toBe("device");
  });

  it("'device' fidelity emits only what the Pi can measure -- spin/axis/start-line absent", async () => {
    const source = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 1, fidelity: "device" });
    await source.start();
    const raw = source.hit("7i");

    expect(raw.ballSpeedMph).toBeGreaterThan(0);
    expect(raw.launchDeg).toBeGreaterThan(0);
    expect(raw.spinRpm).toBeUndefined();
    expect(raw.spinAxisDeg).toBeUndefined();
    expect(raw.startLineDeg).toBeUndefined();

    // the true generated shot is still available, separately, for error analysis
    const trueShot = source.getLastTrueShot();
    expect(trueShot?.spinRpm).toBeDefined();
  });

  it("enrichShot fills 'device'-fidelity gaps and marks them estimated -- the production path", async () => {
    const source = new SimulatedShotSource({ dispersion: PERFECT_DISPERSION, seed: 1, fidelity: "device" });
    await source.start();
    const raw = source.hit("7i");
    const enriched = enrichShot(raw, "7i");

    expect(enriched.provenance.ballSpeed).toBe("measured");
    expect(enriched.provenance.launch).toBe("measured");
    expect(enriched.provenance.spin).toBe("estimated");
    expect(enriched.provenance.spinAxis).toBe("estimated");
    expect(enriched.provenance.startLine).toBe("estimated");
    expect(enriched.spinAxisDeg).toBe(0);
    expect(enriched.startLineDeg).toBe(0);
    expect(enriched.spinRpm).toBeGreaterThan(0);
  });
});

describe("ReplayShotSource", () => {
  function loggedSession(sessionId: string): ShotLog {
    const log = new ShotLog(createMemoryStore());
    const club = findClub("7i");
    for (let i = 0; i < 3; i++) {
      const raw: RawShotEvent = { ballSpeedMph: club.ballSpeedMph, launchDeg: club.launchDeg, timestamp: i };
      log.append({ sessionId, timestamp: i, strokeNumber: i + 1, isPutt: false, penalty: null, raw, shot: enrichShot(raw, "7i") });
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
      strokeNumber: 1,
      isPutt: false,
      penalty: null,
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
