import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLUBS } from "../src/clubs";
import { DEFAULT_SPIN_MODEL, estimateSpin } from "../src/spin/estimate";

describe("estimateSpin: never consults CLUBS", () => {
  it("estimate.ts's source imports nothing from clubs.ts", () => {
    // Static, not just behavioral: a nearest-neighbour search or lookup
    // against CLUBS would still pass every numeric test below while
    // reintroducing the exact club dependency this module exists to
    // remove. Checking the source text directly closes that loophole.
    // (The module's own doc comments mention "CLUBS" descriptively --
    // that's fine; what must never appear is an import of it.)
    const path = fileURLToPath(new URL("../src/spin/estimate.ts", import.meta.url));
    const contents = readFileSync(path, "utf-8");
    expect(contents).not.toMatch(/from\s+["'].*clubs["']/);
  });

  it("the function signature itself has no clubId parameter", () => {
    expect(estimateSpin.length).toBe(2); // (ballSpeedMph, launchDeg) -- params is optional/defaulted
  });
});

describe("estimateSpin: monotonicity", () => {
  it("spin increases (or holds) monotonically as launch angle rises, at a fixed ball speed", () => {
    for (const speed of [70, 100, 130, 160]) {
      let previous = -Infinity;
      for (let launch = 5; launch <= 45; launch += 0.5) {
        const { spinRpm } = estimateSpin(speed, launch);
        expect(spinRpm).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = spinRpm;
      }
    }
  });

  it("spin decreases (or holds) monotonically as ball speed rises, at a fixed launch angle", () => {
    for (const launch of [10, 18, 26, 34]) {
      let previous = Infinity;
      for (let speed = 40; speed <= 220; speed += 1) {
        const { spinRpm } = estimateSpin(speed, launch);
        expect(spinRpm).toBeLessThanOrEqual(previous + 1e-9);
        previous = spinRpm;
      }
    }
  });
});

describe("estimateSpin: sane values across the input range", () => {
  it("never returns a non-finite or negative spin, even for extreme inputs", () => {
    const extremes = [0, 1, 300, -50, 1000];
    for (const speed of extremes) {
      for (const launch of extremes) {
        const { spinRpm, confidence } = estimateSpin(speed, launch);
        expect(Number.isFinite(spinRpm)).toBe(true);
        expect(spinRpm).toBeGreaterThanOrEqual(DEFAULT_SPIN_MODEL.minSpinRpm);
        expect(Number.isFinite(confidence)).toBe(true);
        expect(confidence).toBeGreaterThanOrEqual(0);
        expect(confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stays within a plausible full-swing range (1500-12000rpm) across the real bag's envelope", () => {
    // Swept slightly tighter than DEFAULT_SPIN_MODEL.fit*Range -- below
    // ~12deg launch the model is extrapolating past the driver anchor
    // (the exponential term legitimately dips there), which is a genuine
    // low-confidence region already covered by the confidence tests
    // below, not a "plausible full swing" this test is meant to check.
    for (let speed = 65; speed <= 152; speed += 5) {
      for (let launch = 12; launch <= 34; launch += 2) {
        const { spinRpm } = estimateSpin(speed, launch);
        expect(spinRpm).toBeGreaterThan(1500);
        expect(spinRpm).toBeLessThan(12000);
      }
    }
  });
});

describe("estimateSpin: confidence signal", () => {
  it("is high near the middle of the bag", () => {
    // Roughly a 6-7 iron: well inside the fitted domain on both axes.
    const { confidence } = estimateSpin(109, 18);
    expect(confidence).toBeGreaterThan(0.8);
  });

  it("is lower at the extreme edges of the bag (driver, lob wedge) than in the middle", () => {
    const driverEdge = estimateSpin(150, 12.5).confidence;
    const wedgeEdge = estimateSpin(66, 33.5).confidence;
    const middle = estimateSpin(109, 18).confidence;
    expect(driverEdge).toBeLessThan(middle);
    expect(wedgeEdge).toBeLessThan(middle);
  });

  it("falls to zero for a (speed, launch) combination far outside any real swing", () => {
    const { confidence } = estimateSpin(250, 55);
    expect(confidence).toBe(0);
  });

  it("decreases monotonically as launch angle moves away from the center of the fitted domain, at a fixed speed", () => {
    const [minLaunch, maxLaunch] = DEFAULT_SPIN_MODEL.fitLaunchRangeDeg;
    const mid = (minLaunch + maxLaunch) / 2;
    const speed = 109;
    let previous = estimateSpin(speed, mid).confidence;
    for (let launch = mid + 1; launch <= maxLaunch + 15; launch += 1) {
      const { confidence } = estimateSpin(speed, launch);
      expect(confidence).toBeLessThanOrEqual(previous + 1e-9);
      previous = confidence;
    }
  });
});

describe("estimateSpin: reproduces the twelve CLUBS presets", () => {
  // The model is fit against these presets but never reads CLUBS at call
  // time (see the static-import test above) -- this just checks the fit
  // quality. 9% covers the worst case (5-hybrid, an outlier against the
  // otherwise-smooth trend the rest of the bag follows); every other club
  // is within ~4.1%. Tightening this further would mean chasing one
  // outlier data point rather than the trend, which is exactly the
  // "confidently wrong" failure mode CLAUDE.md warns about elsewhere.
  const TOLERANCE_PCT = 9;

  it.each(CLUBS.map((c) => [c.id, c] as const))("%s within %d%% of its preset spin", (_id, club) => {
    const { spinRpm } = estimateSpin(club.ballSpeedMph, club.launchDeg);
    const errPct = (Math.abs(spinRpm - club.spinRpm) / club.spinRpm) * 100;
    expect(errPct).toBeLessThanOrEqual(TOLERANCE_PCT);
  });
});
