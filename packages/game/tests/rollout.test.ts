import { degToRad, mphToMps, rpmToRadPerSec, type LandingState } from "@mulligan/physics";
import { describe, expect, it } from "vitest";
import { DEFAULT_SURFACE_ROLLOUT, estimateRollout } from "../src/resolver/rollout";
import type { Hole } from "../src/types";

function landingState(descentDeg: number, speedMph: number, spinRpm = 3000): LandingState {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speed: mphToMps(speedMph),
    descentAngle: degToRad(descentDeg),
    spinRate: rpmToRadPerSec(spinRpm),
    spinAxis: 0,
  };
}

const STRAIGHT_DOWNRANGE = { d: 1, l: 0 };

function singleSurfaceHole(type: Hole["surfaces"][number]["type"]): Hole {
  return {
    id: "test",
    name: "Test hole",
    par: 4,
    tee: { x: 0, y: 0 },
    pin: { x: 0, y: 400 },
    surfaces: [
      {
        type,
        points: [
          { x: -100, y: -50 },
          { x: 100, y: -50 },
          { x: 100, y: 500 },
          { x: -100, y: 500 },
        ],
      },
    ],
    bounds: { minX: -150, maxX: 150, minY: -100, maxY: 550 },
  };
}

const ALL_FAIRWAY = singleSurfaceHole("fairway");
const ALL_GREEN = singleSurfaceHole("green");
const ALL_ROUGH = singleSurfaceHole("rough");
const ALL_BUNKER = singleSurfaceHole("bunker");

/** Fairway from y=0 to y=160, rough beyond -- for the surface-crossing test. */
const FAIRWAY_THEN_ROUGH: Hole = {
  id: "test-crossing",
  name: "Test crossing hole",
  par: 4,
  tee: { x: 0, y: 0 },
  pin: { x: 0, y: 400 },
  surfaces: [
    { type: "fairway", points: [{ x: -50, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 160 }, { x: -50, y: 160 }] },
    { type: "rough", points: [{ x: -50, y: 160 }, { x: 50, y: 160 }, { x: 50, y: 500 }, { x: -50, y: 500 }] },
  ],
  bounds: { minX: -100, maxX: 100, minY: -50, maxY: 550 },
};

describe("estimateRollout (M2b, surface-aware)", () => {
  it("is always non-negative and bounded, across every surface", () => {
    for (const hole of [ALL_FAIRWAY, ALL_GREEN, ALL_ROUGH, ALL_BUNKER]) {
      for (const descentDeg of [10, 30, 44, 60, 85]) {
        for (const speedMph of [10, 40, 80, 150]) {
          const roll = estimateRollout(landingState(descentDeg, speedMph), hole, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
          expect(roll).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(roll)).toBe(true);
          expect(roll).toBeLessThanOrEqual(50);
        }
      }
    }
  });

  it("a shallower descent produces more roll than a steeper one at the same speed and surface", () => {
    const shallow = estimateRollout(landingState(20, 60), ALL_FAIRWAY, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    const steep = estimateRollout(landingState(50, 60), ALL_FAIRWAY, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    expect(shallow).toBeGreaterThan(steep);
  });

  it("a faster landing speed produces more roll than a slower one at the same descent angle and surface", () => {
    const fast = estimateRollout(landingState(40, 90), ALL_FAIRWAY, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    const slow = estimateRollout(landingState(40, 30), ALL_FAIRWAY, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    expect(fast).toBeGreaterThan(slow);
  });

  it("more backspin produces less roll at the same landing conditions and surface", () => {
    const lowSpin = estimateRollout(landingState(40, 80, 2800), ALL_GREEN, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    const highSpin = estimateRollout(landingState(40, 80, 9500), ALL_GREEN, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    expect(highSpin).toBeLessThan(lowSpin);
  });

  it("the same landing rolls out further on fairway than on rough, and further on rough than in a bunker", () => {
    const landing = landingState(38, 100, 2800); // driver-like: shallow, fast, low spin
    const pos = { x: 0, y: 100 };
    const onFairway = estimateRollout(landing, ALL_FAIRWAY, pos, STRAIGHT_DOWNRANGE);
    const onRough = estimateRollout(landing, ALL_ROUGH, pos, STRAIGHT_DOWNRANGE);
    const onBunker = estimateRollout(landing, ALL_BUNKER, pos, STRAIGHT_DOWNRANGE);
    expect(onFairway).toBeGreaterThan(onRough);
    expect(onRough).toBeGreaterThan(onBunker);
  });

  it("stops where the rough starts, not at the full fairway-equivalent distance, when the roll crosses a surface boundary", () => {
    const landing = landingState(38, 100, 2800); // driver-like landing
    const landingPos = { x: 0, y: 150 }; // 10yd of fairway left before the rough boundary at y=160
    const allFairwayRoll = estimateRollout(landing, ALL_FAIRWAY, landingPos, STRAIGHT_DOWNRANGE);
    expect(allFairwayRoll).toBeGreaterThan(10); // sanity: this landing has enough roll potential to actually reach the boundary

    const crossingRoll = estimateRollout(landing, FAIRWAY_THEN_ROUGH, landingPos, STRAIGHT_DOWNRANGE);
    expect(crossingRoll).toBeLessThan(allFairwayRoll);
    // Rolled past the boundary (only 10 yards of fairway remained) but
    // clearly checked hard once it crossed into rough -- not still
    // coasting at the fairway-only rate for the rest of its budget.
    expect(crossingRoll).toBeGreaterThan(10);
  });

  it("sanity: a full driver landing on fairway rolls out roughly 15-25 yards (not hardcoded -- see CLAUDE.md's Part C targets)", () => {
    // This game's actual calibrated driver preset lands around 38deg
    // descent, ~58mph (landing speed is much slower than launch speed --
    // most of a driver's 150mph launch bleeds off by landing), low spin.
    const roll = estimateRollout(landingState(38, 58, 2800), ALL_FAIRWAY, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    expect(roll).toBeGreaterThan(10);
    expect(roll).toBeLessThan(30);
  });

  it("sanity: a wedge landing on a green stops nearly dead, roughly 1-3 yards (not hardcoded)", () => {
    // Matches this game's calibrated PW: steep descent (~48deg), slow
    // landing speed (~46mph), heavy backspin.
    const roll = estimateRollout(landingState(48, 46, 9300), ALL_GREEN, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    expect(roll).toBeGreaterThan(1);
    expect(roll).toBeLessThan(4);
  });

  it("a bunker stops the ball almost immediately even for a driver-like landing", () => {
    const roll = estimateRollout(landingState(38, 58, 2800), ALL_BUNKER, { x: 0, y: 100 }, STRAIGHT_DOWNRANGE);
    expect(roll).toBeLessThan(6);
  });

  it("DEFAULT_SURFACE_ROLLOUT has all four named surfaces with sane parameter ranges", () => {
    for (const key of ["fairway", "green", "rough", "bunker"] as const) {
      const params = DEFAULT_SURFACE_ROLLOUT[key];
      expect(params.rolloutMultiplier).toBeGreaterThan(0);
      expect(params.rolloutMultiplier).toBeLessThanOrEqual(1);
      expect(params.spinCheckStrength).toBeGreaterThanOrEqual(0);
      expect(params.spinCheckStrength).toBeLessThanOrEqual(1);
    }
    // Fairway is the reference surface for rolloutMultiplier -- nothing should exceed it.
    expect(DEFAULT_SURFACE_ROLLOUT.fairway.rolloutMultiplier).toBe(1);
  });
});
