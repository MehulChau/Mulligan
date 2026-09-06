/**
 * The lift/drag coefficient model and spin decay, as a swappable, fully
 * data-driven unit.
 *
 * DEFAULT_AERO was calibrated (2026-09-05) against 8 real, sourced
 * measurements -- Trackman's own published PGA Tour Averages, driver
 * through pitching wedge (see MEASUREMENTS in
 * @mulligan/shot-source/calibration/measurements.ts for the exact
 * numbers and source). Before this, every number here was exactly what
 * the original flight-lab.html prototype used, unvalidated against any
 * real shot, which is why descent angle came out ~43-44 degrees for
 * every club regardless of loft -- physically wrong; a driver and a
 * wedge do not land at the same angle.
 *
 * The raw Nelder-Mead fit (fitAeroParams in calibration/fit.ts, run
 * unconstrained) found a lower-error solution than the one below, but it
 * did so by driving spinDecayRate negative -- i.e. spin spontaneously
 * *increasing* during flight, which is not physical, and it is coupled
 * tightly enough to liftCoeff/liftExponent that the two other params
 * cannot simply be kept and the sign flipped back afterward (tried; it
 * makes the fit much worse, not neutral). spinRatioCap and dragCap were
 * also fit to values (1.69, 0.96) far outside the spin-ratio range any
 * of the 8 measurements actually exercise, meaning the fit had no real
 * evidence for those specific numbers -- they just never bound, so the
 * optimizer was free to place them anywhere above the data's range.
 *
 * The numbers below are from a constrained re-fit against the same 8
 * measurements and the same objective (computeResiduals' weighted
 * carry/apex/descent error), with spinDecayRate held strictly positive
 * (physics.invariants.test.ts requires landing spin to be lower than
 * launch spin -- exactly 0 passes the calibration objective just as well
 * but fails that invariant, so the search floor was moved to 0.005) and
 * spinRatioCap/dragCap bounded to a physically generous but sane range.
 * spinDecayRate converged to that floor -- these 8 shots, all similar
 * flight durations, don't contain enough signal to positively identify a
 * decay rate meaningfully above zero; treat 0.005 as "barely enough decay
 * to keep the model's own invariant honest," not as a real measurement of
 * how fast a golf ball's spin actually decays. A future calibration with
 * time-sampled trajectory data (not just endpoint carry/apex/descent)
 * could pin this down properly.
 *
 * Result, validated against the 8 measurements themselves: descent angle
 * predictions land within ~0.3-2.2 degrees of the real Trackman values
 * across the whole driver-to-PW range (38 degrees to 52 degrees). Applied
 * to this game's own CLUBS presets (not the measurements directly --
 * CLUBS is a generic, not-yet-player-calibrated bag, a separate gap
 * `npm run rescale-clubs` exists for), the visible in-game spread is
 * real but more compressed: ~38 degrees for the driver up to ~44-48
 * degrees across the rest of the bag, rather than smoothly climbing to
 * 52 like the raw tour data. See CLAUDE.md for the full before/after
 * table and why the two views differ. Retuning further is the
 * calibration harness's job (@mulligan/shot-source/calibration/fit.ts),
 * driven by more/better MEASUREMENTS, not a hand-edit here.
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
  spinRatioCap: 1.16,
  liftCoeff: 0.882,
  liftExponent: 0.714,
  liftCap: 0.345,
  dragBase: 0.251,
  dragSlope: 0.271,
  dragCap: 0.531,
  spinDecayRate: 0.005,
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
