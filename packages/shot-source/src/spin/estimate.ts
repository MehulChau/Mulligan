/**
 * Estimates spin from measured launch conditions alone -- no club
 * selection involved. High-end launch monitors measure spin directly;
 * budget units (Garmin R10, Mevo, Rapsodo) fall back to a club lookup for
 * the same reason we used to: they don't measure it either. But spin
 * correlates with loft, and loft is visible in the two things a v1 device
 * *does* measure (ball speed, launch angle) without a lookup, because
 * across a real bag, spin rises monotonically as ball speed falls and
 * launch angle rises. That correlation is what this module fits.
 *
 * This matters for two reasons: it makes the device work for any golfer,
 * not just one whose swing matches `CLUBS`, and it moves clubId out of the
 * physics entirely -- the club a player picked is a statement of intent,
 * not a measurement, and it should never have been an input to a spin
 * estimate in the first place.
 *
 * Known limitation, by design, not oversight: a three-quarter 7-iron and a
 * full 9-iron can produce nearly identical (ballSpeedMph, launchDeg) while
 * carrying different spin -- swing mechanics beyond speed and launch angle
 * (attack angle, dynamic loft, strike quality) genuinely affect spin, and
 * none of that is visible to a device that only measures speed and launch.
 * This model cannot and does not try to distinguish those two swings. That
 * is the accepted cost of not measuring spin directly, not a bug to chase
 * -- the v2+ dimple-tracking stretch goal (CLAUDE.md's measurement
 * contract) is what actually fixes it, by measuring spin instead of
 * inferring it.
 */

export interface SpinModelParams {
  /** rpm at (launchRefDeg, speedRefMph) -- the anchor the curve is built from. */
  floorRpm: number;
  /** Total additional rpm the exponential term can contribute as launch rises well past launchRefDeg (its asymptotic range). */
  rangeRpm: number;
  /** How quickly spin approaches that ceiling as launch increases past launchRefDeg, per degree. Must be > 0 -- see the monotonicity note below. */
  ratePerDeg: number;
  /** rpm removed per mph of ball speed above speedRefMph (and added per mph below it). Must be >= 0 -- see the monotonicity note below. */
  speedCoeffRpmPerMph: number;
  launchRefDeg: number;
  speedRefMph: number;
  /** Spin never estimates below this floor -- a full golf shot always carries some real backspin; the raw formula has no reason to respect that on its own. */
  minSpinRpm: number;
  /**
   * The (launchDeg, ballSpeedMph) domain this model was fit against --
   * used ONLY to shape the confidence signal (how far a query sits from
   * the well-supported middle of the bag), never to look up or compare
   * against individual clubs. This is two pairs of numbers, not a search
   * over CLUBS at call time -- estimateSpin() never reads CLUBS.
   */
  fitLaunchRangeDeg: [number, number];
  fitSpeedRangeMph: [number, number];
}

/**
 * Fit against CLUBS (packages/shot-source/src/clubs.ts) -- those twelve
 * presets are themselves derived from published launch-monitor averages,
 * so they're a reasonable seed surface even though this function never
 * touches CLUBS at runtime.
 *
 * Form: floor + range*(1 - exp(-rate*(launch - launchRef))) - speedCoeff*(speed - speedRef).
 * Chosen over a quadratic-in-launch fit (which reproduced the twelve
 * presets slightly tighter, ~7% worst-case) specifically because a
 * parabola is not monotonic -- its fitted vertex landed at ~33 degrees,
 * right at the top of the bag, so it would have predicted *less* spin for
 * a steeper lob-wedge-like swing than a shallower one. This saturating
 * exponential is monotonic increasing in launch and monotonic decreasing
 * in speed for every input, not just within the fitted range, by
 * construction -- there is no coefficient sign that breaks it.
 *
 * Reproduces the twelve CLUBS presets to within 8.7% (worst case:
 * 5-hybrid, an outlier against the smooth trend the rest of the bag
 * follows); every other club is within ~4.1%. See estimate.test.ts for
 * the exact per-club tolerance this is checked against.
 */
export const DEFAULT_SPIN_MODEL: SpinModelParams = {
  floorRpm: 2787.5,
  rangeRpm: 8370.2,
  ratePerDeg: 0.104,
  speedCoeffRpmPerMph: 3.05,
  launchRefDeg: 12.5,
  speedRefMph: 150,
  minSpinRpm: 200,
  fitLaunchRangeDeg: [12.5, 33.5],
  fitSpeedRangeMph: [66, 150],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Confidence for one axis: 1.0 at the center of the fitted domain, easing
 * down to 0.7 at either edge of it (an edge club like a driver or lob
 * wedge has data on only one side of it, so it's less cross-validated
 * than the middle of the bag), then continuing to fall for a genuine
 * extrapolation beyond the fitted range, reaching 0 at 60% past the edge.
 * Deliberately a function of two fixed range bounds baked into
 * `SpinModelParams`, not a search over individual club records.
 */
function axisConfidence(value: number, [min, max]: [number, number]): number {
  const mid = (min + max) / 2;
  const halfSpan = (max - min) / 2;
  if (halfSpan <= 0) return 1;
  const normalized = Math.abs(value - mid) / halfSpan;
  if (normalized <= 1) return 1 - 0.3 * normalized;
  const overshoot = normalized - 1;
  return Math.max(0, 0.7 - overshoot / 0.6);
}

/**
 * Estimates spin from measured ball speed and launch angle alone. Never
 * reads `CLUBS` and takes no clubId -- see the module doc comment for why.
 *
 * `confidence` is in [0, 1]: high in the well-supported middle of the bag,
 * lower at the driver/lob-wedge extremes (real data on only one side),
 * and falling toward 0 for a (speed, launch) combination that doesn't
 * look like any full golf swing the model was fit against.
 */
export function estimateSpin(
  ballSpeedMph: number,
  launchDeg: number,
  params: SpinModelParams = DEFAULT_SPIN_MODEL,
): { spinRpm: number; confidence: number } {
  const raw =
    params.floorRpm +
    params.rangeRpm * (1 - Math.exp(-params.ratePerDeg * (launchDeg - params.launchRefDeg))) -
    params.speedCoeffRpmPerMph * (ballSpeedMph - params.speedRefMph);

  const spinRpm = Math.max(params.minSpinRpm, raw);
  const confidence = clamp(
    axisConfidence(launchDeg, params.fitLaunchRangeDeg) * axisConfidence(ballSpeedMph, params.fitSpeedRangeMph),
    0,
    1,
  );

  return { spinRpm, confidence };
}
