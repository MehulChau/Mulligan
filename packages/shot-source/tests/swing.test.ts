import { describe, expect, it } from "vitest";
import { findClub } from "../src/clubs";
import { DEFAULT_DISPERSION } from "../src/dispersion";
import {
  FULL_SWING_FRACTION,
  MIN_SWING_FRACTION,
  clampSwingFraction,
  scaleClubForSwing,
  scaleDispersionForSwing,
} from "../src/swing";

describe("clampSwingFraction", () => {
  it("clamps to [MIN_SWING_FRACTION, FULL_SWING_FRACTION]", () => {
    expect(clampSwingFraction(0)).toBe(MIN_SWING_FRACTION);
    expect(clampSwingFraction(0.1)).toBe(MIN_SWING_FRACTION);
    expect(clampSwingFraction(2)).toBe(FULL_SWING_FRACTION);
    expect(clampSwingFraction(0.75)).toBeCloseTo(0.75);
  });
});

describe("scaleClubForSwing", () => {
  const lw = findClub("lw");

  it("a full swing (fraction 1) reproduces the club preset exactly", () => {
    const scaled = scaleClubForSwing(lw, 1);
    expect(scaled.ballSpeedMph).toBeCloseTo(lw.ballSpeedMph);
    expect(scaled.spinRpm).toBeCloseTo(lw.spinRpm);
    expect(scaled.launchDeg).toBeCloseTo(lw.launchDeg);
  });

  it("a partial swing scales ball speed and spin down, and nudges launch up", () => {
    const scaled = scaleClubForSwing(lw, 0.5);
    expect(scaled.ballSpeedMph).toBeCloseTo(lw.ballSpeedMph * 0.5);
    expect(scaled.spinRpm).toBeCloseTo(lw.spinRpm * 0.5);
    expect(scaled.launchDeg).toBeGreaterThan(lw.launchDeg);
  });

  it("carry strictly increases with swing fraction across the full range", () => {
    // Not a physics claim -- just confirms the scaling is monotonic input,
    // which the actual carry-vs-fraction relationship (checked via
    // simulation elsewhere) depends on.
    let previous = 0;
    for (let f = MIN_SWING_FRACTION; f <= FULL_SWING_FRACTION + 1e-9; f += 0.1) {
      const scaled = scaleClubForSwing(lw, f);
      expect(scaled.ballSpeedMph).toBeGreaterThan(previous);
      previous = scaled.ballSpeedMph;
    }
  });

  it("clamps fractions outside [MIN_SWING_FRACTION, 1]", () => {
    const tooSoft = scaleClubForSwing(lw, 0);
    const clamped = scaleClubForSwing(lw, MIN_SWING_FRACTION);
    expect(tooSoft).toEqual(clamped);

    const tooHard = scaleClubForSwing(lw, 1.5);
    expect(tooHard).toEqual(scaleClubForSwing(lw, 1));
  });

  it("preserves club id and name -- a partial swing is still the same club", () => {
    const scaled = scaleClubForSwing(lw, 0.6);
    expect(scaled.id).toBe(lw.id);
    expect(scaled.name).toBe(lw.name);
  });
});

describe("scaleDispersionForSwing", () => {
  it("a full swing reproduces the input dispersion exactly", () => {
    const scaled = scaleDispersionForSwing(DEFAULT_DISPERSION, 1);
    expect(scaled).toEqual(DEFAULT_DISPERSION);
  });

  it("shrinks the noise/sigma fields for a partial swing, without touching quality shaping", () => {
    const scaled = scaleDispersionForSwing(DEFAULT_DISPERSION, 0.5);
    expect(scaled.ballSpeedNoiseSigmaPct).toBeCloseTo(DEFAULT_DISPERSION.ballSpeedNoiseSigmaPct * 0.5);
    expect(scaled.launchAngleNoiseSigmaDeg).toBeCloseTo(DEFAULT_DISPERSION.launchAngleNoiseSigmaDeg * 0.5);
    expect(scaled.spinNoiseSigmaPct).toBeCloseTo(DEFAULT_DISPERSION.spinNoiseSigmaPct * 0.5);
    expect(scaled.startLineSigmaDeg).toBeCloseTo(DEFAULT_DISPERSION.startLineSigmaDeg * 0.5);
    expect(scaled.spinAxisSigmaDeg).toBeCloseTo(DEFAULT_DISPERSION.spinAxisSigmaDeg * 0.5);
    // strikeQualitySpread and the quality-blend factors are left alone --
    // "shorter swing is more repeatable" narrows dispersion sigmas, it
    // doesn't change how strike quality itself is modeled.
    expect(scaled.strikeQualitySpread).toBe(DEFAULT_DISPERSION.strikeQualitySpread);
    expect(scaled.ballSpeedBaseFactor).toBe(DEFAULT_DISPERSION.ballSpeedBaseFactor);
    expect(scaled.ballSpeedQualityFactor).toBe(DEFAULT_DISPERSION.ballSpeedQualityFactor);
  });
});
