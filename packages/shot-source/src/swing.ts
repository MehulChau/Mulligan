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
  /**
   * Scales the two *absolute-degree* launch-variance sigmas
   * (`launchAngleNoiseSigmaDeg`, `launchAngleThinFatBiasDeg`) by
   * fraction^exponent. Legitimate to shrink with a gentler swing: a given
   * physical strike-angle wobble is a smaller absolute launch-angle error
   * at lower clubhead speed.
   */
  dispersionExponent: number;
  /**
   * Grows the *percentage/angle* sigmas (`ballSpeedNoiseSigmaPct`,
   * `spinNoiseSigmaPct`, `startLineSigmaDeg`, `spinAxisSigmaDeg`) back up as
   * the swing gets shorter, instead of shrinking them. These are relative
   * measures, so they already produce a smaller absolute error on a
   * shorter shot for free (2% of a slower ball speed, or 2 degrees of a
   * shorter carry, is already a small yardage/lateral miss) -- multiplying
   * them by the swing fraction on top of that double-counts the shrinkage
   * and makes a partial wedge preternaturally precise. Partial-swing
   * distance control is, if anything, the hardest shot in golf to control,
   * not the easiest. At `MIN_SWING_FRACTION` these sigmas are multiplied by
   * `1 + partialSwingPenalty`; at a full swing they're unchanged. This
   * number is a placeholder guess, not derived from physics -- tune it
   * against real range dispersion data once it exists, same posture as
   * `AeroParams`.
   */
  partialSwingPenalty: number;
}

export const DEFAULT_SWING_SCALING: SwingScalingParams = {
  ballSpeedExponent: 1,
  spinExponent: 1,
  launchDegPerFractionBelowFull: 4,
  dispersionExponent: 1,
  partialSwingPenalty: 4,
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

/**
 * Dispersion adjusted for a partial swing. NOT a uniform shrink -- see
 * `SwingScalingParams` for why the percentage/angle sigmas
 * (`ballSpeedNoiseSigmaPct`, `spinNoiseSigmaPct`, `startLineSigmaDeg`,
 * `spinAxisSigmaDeg`) are grown, not shrunk, as the swing gets shorter,
 * while the absolute-degree launch sigmas are shrunk as before.
 */
export function scaleDispersionForSwing(
  dispersion: DispersionParams,
  fraction: number,
  params: SwingScalingParams = DEFAULT_SWING_SCALING,
): DispersionParams {
  const f = clampSwingFraction(fraction);

  const launchScale = Math.pow(f, params.dispersionExponent);

  const penaltyRange = FULL_SWING_FRACTION - MIN_SWING_FRACTION;
  const softness = penaltyRange > 0 ? (FULL_SWING_FRACTION - f) / penaltyRange : 0;
  const relativePenalty = 1 + params.partialSwingPenalty * softness;

  return {
    ...dispersion,
    ballSpeedNoiseSigmaPct: dispersion.ballSpeedNoiseSigmaPct * relativePenalty,
    spinNoiseSigmaPct: dispersion.spinNoiseSigmaPct * relativePenalty,
    startLineSigmaDeg: dispersion.startLineSigmaDeg * relativePenalty,
    spinAxisSigmaDeg: dispersion.spinAxisSigmaDeg * relativePenalty,
    launchAngleNoiseSigmaDeg: dispersion.launchAngleNoiseSigmaDeg * launchScale,
    launchAngleThinFatBiasDeg: dispersion.launchAngleThinFatBiasDeg * launchScale,
  };
}
