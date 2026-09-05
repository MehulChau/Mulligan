import type { ClubProfile } from "./clubs";
import type { DispersionParams } from "./dispersion";

/**
 * How hard a wedge was swung, as a fraction of a full swing. This is a game
 * concept, not a device measurement -- the Pi only ever reports the ball
 * speed a swing actually produced, so `swingFraction` never appears on
 * `RawShotEvent`. It exists purely so `SimulatedShotSource` can generate a
 * plausible partial-swing shot for a chosen club, standing in for the
 * three-quarter/half wedges every real golfer actually practices.
 */
export const MIN_SWING_FRACTION = 0.3;
export const FULL_SWING_FRACTION = 1;

export function clampSwingFraction(fraction: number): number {
  return Math.min(FULL_SWING_FRACTION, Math.max(MIN_SWING_FRACTION, fraction));
}

export interface SwingScalingParams {
  /** ballSpeed = club.ballSpeedMph * fraction^exponent -- 1 is a straight linear scale-down. */
  ballSpeedExponent: number;
  /**
   * spin = club.spinRpm * fraction^exponent. A real partial wedge holds
   * relatively more spin than a linear scale-down implies (a steeper,
   * shorter swing imparts spin less proportionally to speed), but modeling
   * that precisely needs real range data. 1 (proportional) is the
   * placeholder until that data exists -- same posture as `AeroParams`.
   */
  spinExponent: number;
  /** Degrees of launch added per unit of fraction below full -- a shorter swing tends to launch a bit higher relative to its speed. */
  launchDegPerFractionBelowFull: number;
  /** Dispersion sigmas scale by fraction^exponent -- a shorter swing is more repeatable than a full one. */
  dispersionExponent: number;
}

export const DEFAULT_SWING_SCALING: SwingScalingParams = {
  ballSpeedExponent: 1,
  spinExponent: 1,
  launchDegPerFractionBelowFull: 4,
  dispersionExponent: 1,
};

/** The club profile a partial swing would produce -- ball speed and spin scaled down, launch nudged up. Clamped to [MIN_SWING_FRACTION, 1]. */
export function scaleClubForSwing(
  club: ClubProfile,
  fraction: number,
  params: SwingScalingParams = DEFAULT_SWING_SCALING,
): ClubProfile {
  const f = clampSwingFraction(fraction);
  return {
    ...club,
    ballSpeedMph: club.ballSpeedMph * Math.pow(f, params.ballSpeedExponent),
    spinRpm: club.spinRpm * Math.pow(f, params.spinExponent),
    launchDeg: club.launchDeg + (1 - f) * params.launchDegPerFractionBelowFull,
  };
}

/** Dispersion sigmas shrunk for a partial swing -- a half-swing wedge is more repeatable, not just shorter. */
export function scaleDispersionForSwing(
  dispersion: DispersionParams,
  fraction: number,
  params: SwingScalingParams = DEFAULT_SWING_SCALING,
): DispersionParams {
  const f = clampSwingFraction(fraction);
  const scale = Math.pow(f, params.dispersionExponent);
  return {
    ...dispersion,
    ballSpeedNoiseSigmaPct: dispersion.ballSpeedNoiseSigmaPct * scale,
    launchAngleNoiseSigmaDeg: dispersion.launchAngleNoiseSigmaDeg * scale,
    launchAngleThinFatBiasDeg: dispersion.launchAngleThinFatBiasDeg * scale,
    spinNoiseSigmaPct: dispersion.spinNoiseSigmaPct * scale,
    startLineSigmaDeg: dispersion.startLineSigmaDeg * scale,
    spinAxisSigmaDeg: dispersion.spinAxisSigmaDeg * scale,
  };
}
