import { describe, expect, it } from "vitest";
import { findClub } from "../src/clubs";
import { DEFAULT_DISPERSION, PERFECT_DISPERSION, sampleStrikeQuality, simulateShot } from "../src/dispersion";
import { mulberry32 } from "../src/rng";

describe("sampleStrikeQuality", () => {
  it("is always exactly 1 when spread is 0, regardless of the rng", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 20; i++) {
      expect(sampleStrikeQuality(rng, 0)).toBe(1);
    }
  });

  it("clusters most samples as decent (>0.65) with a minority poor, given spread 0.35", () => {
    const rng = mulberry32(42);
    const samples = Array.from({ length: 2000 }, () => sampleStrikeQuality(rng, 0.35));
    const decent = samples.filter((q) => q > 0.65).length;
    expect(decent / samples.length).toBeGreaterThan(0.6);
    expect(samples.some((q) => q < 0.5)).toBe(true); // a real minority of poor strikes exists
    expect(samples.every((q) => q >= 0 && q <= 1)).toBe(true);
  });
});

describe("simulateShot", () => {
  const driver = findClub("driver");
  const sevenIron = findClub("7i");

  it("PERFECT_DISPERSION reproduces the club preset exactly, straight, for any seed", () => {
    for (const seed of [1, 2, 12345]) {
      const rng = mulberry32(seed);
      const shot = simulateShot(driver, PERFECT_DISPERSION, rng, 1000);
      expect(shot.ballSpeedMph).toBeCloseTo(driver.ballSpeedMph, 10);
      expect(shot.launchDeg).toBeCloseTo(driver.launchDeg, 10);
      expect(shot.spinRpm).toBeCloseTo(driver.spinRpm, 10);
      expect(shot.spinAxisDeg).toBe(0);
      expect(shot.startLineDeg).toBe(0);
    }
  });

  it("DEFAULT_DISPERSION produces different shots for different seeds", () => {
    const a = simulateShot(sevenIron, DEFAULT_DISPERSION, mulberry32(1), 1000);
    const b = simulateShot(sevenIron, DEFAULT_DISPERSION, mulberry32(2), 1000);
    expect(a.ballSpeedMph).not.toBeCloseTo(b.ballSpeedMph, 5);
  });

  it("ten simulated 7-irons produce ten visibly different results", () => {
    const rng = mulberry32(7);
    const shots = Array.from({ length: 10 }, () => simulateShot(sevenIron, DEFAULT_DISPERSION, rng, 1000));
    const distinctSpeeds = new Set(shots.map((s) => s.ballSpeedMph.toFixed(3)));
    expect(distinctSpeeds.size).toBe(10);
  });

  it("scales spin by the ball-speed ratio, not just the preset value", () => {
    // force a specific, large deviation to make the ratio effect unambiguous
    const params = { ...PERFECT_DISPERSION, ballSpeedQualityFactor: 0, ballSpeedBaseFactor: 1.2 };
    const rng = mulberry32(1);
    const shot = simulateShot(sevenIron, params, rng, 1000);
    expect(shot.ballSpeedMph).toBeCloseTo(sevenIron.ballSpeedMph * 1.2, 5);
    expect(shot.spinRpm).toBeCloseTo(sevenIron.spinRpm * 1.2, 5);
  });

  it("correlates spin axis with start line so pushes tend to fade", () => {
    const params = { ...PERFECT_DISPERSION, startLineSigmaDeg: 3, spinAxisStartLineCorrelation: 1 };
    const rng = mulberry32(9);
    const shot = simulateShot(sevenIron, params, rng, 1000);
    expect(shot.startLineDeg).not.toBe(0);
    expect(shot.spinAxisDeg).toBeCloseTo(shot.startLineDeg!, 10); // correlation 1, zero independent noise
  });
});
