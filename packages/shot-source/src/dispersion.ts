import type { ClubProfile } from "./clubs";
import { clamp, gaussian } from "./rng";
import type { RawShotEvent } from "./types";

export interface DispersionParams {
  /** Scales the gaussian that produces strikeQuality — 0 forces quality to exactly 1. */
  strikeQualitySpread: number;
  /** ballSpeed = preset * (ballSpeedBaseFactor + ballSpeedQualityFactor * quality) */
  ballSpeedBaseFactor: number;
  ballSpeedQualityFactor: number;
  ballSpeedNoiseSigmaPct: number;
  launchAngleNoiseSigmaDeg: number;
  /** Extra launch (degrees) added on poor strikes, scaled by (1 - quality). */
  launchAngleThinFatBiasDeg: number;
  spinNoiseSigmaPct: number;
  startLineSigmaDeg: number;
  spinAxisSigmaDeg: number;
  /** How much of startLine's deviation bleeds into spin axis — pushes tend to fade. */
  spinAxisStartLineCorrelation: number;
}

export const DEFAULT_DISPERSION: DispersionParams = {
  strikeQualitySpread: 0.35,
  ballSpeedBaseFactor: 0.88,
  ballSpeedQualityFactor: 0.12,
  ballSpeedNoiseSigmaPct: 0.02,
  launchAngleNoiseSigmaDeg: 1.5,
  launchAngleThinFatBiasDeg: 3,
  spinNoiseSigmaPct: 0.08,
  startLineSigmaDeg: 2.0,
  spinAxisSigmaDeg: 4,
  spinAxisStartLineCorrelation: 0.5,
};

/**
 * All sigmas zero, quality always 1 — deterministic shots for tests.
 * strikeQualitySpread: 0 forces quality === 1, which makes
 * (ballSpeedBaseFactor + ballSpeedQualityFactor * quality) === 1 using the
 * same base/quality factors as DEFAULT_DISPERSION — no separate constant
 * needed for that part.
 */
export const PERFECT_DISPERSION: DispersionParams = {
  ...DEFAULT_DISPERSION,
  strikeQualitySpread: 0,
  ballSpeedNoiseSigmaPct: 0,
  launchAngleNoiseSigmaDeg: 0,
  launchAngleThinFatBiasDeg: 0,
  spinNoiseSigmaPct: 0,
  startLineSigmaDeg: 0,
  spinAxisSigmaDeg: 0,
  spinAxisStartLineCorrelation: 0,
};

/**
 * Per-shot strike quality in [0, 1]. Most shots cluster near 1 (decent); a
 * minority, out in the gaussian's tail, are poor. Named and tunable via
 * `spread` rather than inlined, per M1 spec.
 */
export function sampleStrikeQuality(rng: () => number, spread: number): number {
  return clamp(1 - Math.abs(gaussian(rng)) * spread, 0, 1);
}

/** Simulates one shot with a given club and dispersion model. Pure given `rng`. */
export function simulateShot(
  club: ClubProfile,
  params: DispersionParams,
  rng: () => number,
  timestamp: number,
): RawShotEvent {
  const quality = sampleStrikeQuality(rng, params.strikeQualitySpread);

  const ballSpeedMph = Math.max(
    1,
    club.ballSpeedMph *
      (params.ballSpeedBaseFactor + params.ballSpeedQualityFactor * quality) *
      (1 + gaussian(rng) * params.ballSpeedNoiseSigmaPct),
  );

  const launchDeg = Math.max(
    0.5,
    club.launchDeg +
      gaussian(rng) * params.launchAngleNoiseSigmaDeg +
      (1 - quality) * params.launchAngleThinFatBiasDeg,
  );

  const speedRatio = ballSpeedMph / club.ballSpeedMph;
  const spinRpm = Math.max(
    0,
    club.spinRpm * speedRatio * (1 + gaussian(rng) * params.spinNoiseSigmaPct),
  );

  const startLineDeg = gaussian(rng) * params.startLineSigmaDeg;
  const spinAxisDeg =
    startLineDeg * params.spinAxisStartLineCorrelation + gaussian(rng) * params.spinAxisSigmaDeg;

  return { ballSpeedMph, launchDeg, spinRpm, spinAxisDeg, startLineDeg, timestamp };
}
