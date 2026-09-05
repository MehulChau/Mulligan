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

  it("shrinks the absolute-degree launch sigmas for a partial swing -- these are legitimately easier to control at lower clubhead speed", () => {
    const scaled = scaleDispersionForSwing(DEFAULT_DISPERSION, 0.5);
    expect(scaled.launchAngleNoiseSigmaDeg).toBeCloseTo(DEFAULT_DISPERSION.launchAngleNoiseSigmaDeg * 0.5);
    expect(scaled.launchAngleThinFatBiasDeg).toBeCloseTo(DEFAULT_DISPERSION.launchAngleThinFatBiasDeg * 0.5);
  });

  it("GROWS the percentage/angle sigmas for a partial swing -- they already shrink in absolute terms for free, so naively multiplying them by the fraction double-counts that and makes a partial wedge preternaturally precise (the M2a.1 bug)", () => {
    const scaled = scaleDispersionForSwing(DEFAULT_DISPERSION, 0.5);
    expect(scaled.ballSpeedNoiseSigmaPct).toBeGreaterThan(DEFAULT_DISPERSION.ballSpeedNoiseSigmaPct);
    expect(scaled.spinNoiseSigmaPct).toBeGreaterThan(DEFAULT_DISPERSION.spinNoiseSigmaPct);
    expect(scaled.startLineSigmaDeg).toBeGreaterThan(DEFAULT_DISPERSION.startLineSigmaDeg);
    expect(scaled.spinAxisSigmaDeg).toBeGreaterThan(DEFAULT_DISPERSION.spinAxisSigmaDeg);
  });

  it("the percentage/angle penalty shrinks monotonically as the swing gets fuller, reaching 1x (no change) at a full swing", () => {
    let previous = Infinity;
    for (let f = MIN_SWING_FRACTION; f < FULL_SWING_FRACTION; f += 0.1) {
      const scaled = scaleDispersionForSwing(DEFAULT_DISPERSION, f);
      expect(scaled.startLineSigmaDeg).toBeLessThanOrEqual(previous);
      previous = scaled.startLineSigmaDeg;
    }
    expect(scaleDispersionForSwing(DEFAULT_DISPERSION, FULL_SWING_FRACTION).startLineSigmaDeg).toBeCloseTo(
      DEFAULT_DISPERSION.startLineSigmaDeg,
    );
  });

  it("leaves quality shaping alone -- the penalty only touches noise/dispersion sigmas, not how strike quality itself is modeled", () => {
    const scaled = scaleDispersionForSwing(DEFAULT_DISPERSION, 0.5);
    expect(scaled.strikeQualitySpread).toBe(DEFAULT_DISPERSION.strikeQualitySpread);
    expect(scaled.ballSpeedBaseFactor).toBe(DEFAULT_DISPERSION.ballSpeedBaseFactor);
    expect(scaled.ballSpeedQualityFactor).toBe(DEFAULT_DISPERSION.ballSpeedQualityFactor);
  });
});
