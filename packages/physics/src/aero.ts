/**
 * The lift/drag coefficient model and spin decay, as a swappable, fully
 * data-driven unit. Every number in DEFAULT_AERO is exactly what the
 * original flight-lab.html prototype used — unchanged in this milestone.
 * Retuning against real range data is the calibration harness's job
 * (see calibration/fit.ts in @mulligan/shot-source), not a code change here.
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
  spinRatioCap: 0.35,
  liftCoeff: 0.54,
  liftExponent: 0.4,
  liftCap: 0.34,
  dragBase: 0.22,
  dragSlope: 0.55,
  dragCap: 0.34,
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
