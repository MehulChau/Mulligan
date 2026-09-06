/**
 * The lift/drag coefficient model and spin decay, as a swappable, fully
 * data-driven unit.
 *
 * DEFAULT_AERO is calibrated against 8 real, sourced measurements --
 * Trackman's own published PGA Tour Averages, driver through pitching
 * wedge (see MEASUREMENTS in
 * @mulligan/shot-source/calibration/measurements.ts for the exact numbers
 * and source). Before any calibration, every number here was exactly what
 * the original flight-lab.html prototype used, unvalidated against any
 * real shot, which is why descent angle came out ~43-44 degrees for every
 * club regardless of loft -- physically wrong; a driver and a wedge do not
 * land at the same angle.
 *
 * **Reworked 2026-09-06 after a second-opinion review of the first
 * calibration (2026-09-05) found a real regression it had missed.** That
 * fit weighted descent 5x against carry/apex 1x, on the reasoning that
 * descent is what disambiguates the (CL, CD) pair carry alone can't. It
 * did cut mean descent error from 4.6deg to 0.9deg -- but the weighting
 * bought that by silently pushing mean carry error from 3.9% to 6.4%, a
 * one-directional bias (every club reading short, worsening from -2.6% at
 * 152mph to -9.6% at 102mph) that the shipped report never surfaced
 * because it only ever printed descent accuracy in detail. Two concrete
 * fixes came out of that review:
 *
 * 1. **spinDecayRate is now pinned at 0.033 (PHYSICAL_SPIN_DECAY_RATE in
 *    calibration/fit.ts), not searched.** The 2026-09-05 version searched
 *    it, found it wanted to go negative (spin spontaneously increasing in
 *    flight -- not physical), and concluded from a flawed test (reverting
 *    just that one parameter on top of an otherwise-unconstrained fit)
 *    that it was too tightly coupled to the other 7 to pin safely. A
 *    proper refit -- pin spinDecayRate, re-optimize the other 7 around
 *    that fixed point, with several random restarts to avoid a bad local
 *    minimum -- shows that claim doesn't hold: it costs only ~6-7% in
 *    fit error, not the ~180% the flawed comparison implied. 0.033
 *    (roughly 3.3%/s) is also the well-documented real-world figure for
 *    golf ball backspin decay, so this isn't just "a value that fits
 *    fine" -- it's the physically correct one.
 * 2. **The carry/apex/descent weighting moved from (1, 1, 5) to (8, 1,
 *    10)** (DEFAULT_FIT_WEIGHTS in calibration/fit.ts), found via a grid
 *    search over the weight pair with spinDecayRate held at the pinned
 *    value from (1). This is a genuine Pareto frontier, not a free lunch:
 *    pushing descent error much below where it sits here costs carry
 *    accuracy, and vice versa (see CLAUDE.md's "Part B rework" section for
 *    the full grid). (8, 10) is the point on that frontier closest to
 *    simultaneously hitting ~3% carry error and ~1.5deg descent error --
 *    it does not zero out either.
 *
 * Result, validated against the 8 measurements themselves (report all
 * three targets, not just descent -- that asymmetry is exactly what let
 * the first calibration's carry regression go unnoticed): mean carry
 * error 6.4% -> 3.3% (max 9.6% -> 6.9%), mean descent error 4.6deg ->
 * 1.5deg. Mean apex error moved from 5.1% to 8.7% -- apex was never an
 * explicit target of the rebalancing and is the one place this fit is
 * worse than the 2026-09-05 version; it wasn't traded against on purpose,
 * it's a side effect of the reweighting, and is left as a known gap
 * rather than chased with a third weight, since carry and descent were
 * the two explicitly requested targets.
 *
 * The functional form itself (CL = liftCoeff * S^liftExponent capped, CD
 * = dragBase + dragSlope * S capped) was considered for extension -- real
 * golf ball drag depends on Reynolds number as well as spin ratio, and a
 * sigmoid-shaped transition around a critical speed (the "drag crisis")
 * is the physically motivated way to add that, not a linear speed term
 * (tried during this rework; the fit drove its coefficient to zero,
 * meaning the data doesn't support even that simple an extension). Not
 * pursued further because the reweighted fit above already meets the
 * explicit carry/descent targets without it -- extending AeroParams is a
 * larger, riskier change than this rework needed, and "don't ship
 * complexity that isn't demonstrably earning its keep" applies here same
 * as anywhere else in this codebase.
 *
 * Applied to this game's own CLUBS presets (not the measurements directly
 * -- CLUBS is a generic, not-yet-player-calibrated bag, a separate gap
 * `npm run rescale-clubs` exists for), the visible in-game descent spread
 * is real but more compressed than the raw tour data's smooth climb to
 * 52deg. See CLAUDE.md for the full before/after table and why the two
 * views differ. Retuning further is the calibration harness's job
 * (@mulligan/shot-source/calibration/fit.ts), driven by more/better
 * MEASUREMENTS, not a hand-edit here.
 */

export interface AeroParams {
  /** Spin ratio S = omega*r/v is clamped to this before computing CL/CD. */
  spinRatioCap: number;
  /** CL = min(liftCap, liftCoeff * S^liftExponent) */
  liftCoeff: number;
  liftExponent: number;
  liftCap: number;
  /** CD = min(dragCap, dragBase + dragSlope * S) */
  dragBase: number;
  dragSlope: number;
  dragCap: number;
  /** Fractional spin loss per second: spin *= exp(-spinDecayRate * dt) */
  spinDecayRate: number;
}

export const DEFAULT_AERO: AeroParams = {
  spinRatioCap: 1.326,
  liftCoeff: 1.059,
  liftExponent: 0.793,
  liftCap: 0.348,
  dragBase: 0.243,
  dragSlope: 0.250,
  dragCap: 0.478,
  spinDecayRate: 0.033,
};

export interface AeroModel {
  coefficients(spinRatio: number): { CL: number; CD: number };
  spinDecay(spinRate: number, dt: number): number;
}

export function makeAeroModel(params: AeroParams = DEFAULT_AERO): AeroModel {
  return {
    coefficients(spinRatioRaw: number) {
      const S = Math.min(params.spinRatioCap, spinRatioRaw);
      const CL = Math.min(params.liftCap, params.liftCoeff * Math.pow(S, params.liftExponent));
      const CD = Math.min(params.dragCap, params.dragBase + params.dragSlope * S);
      return { CL, CD };
    },
    spinDecay(spinRate: number, dt: number) {
      return spinRate * Math.exp(-params.spinDecayRate * dt);
    },
  };
}
