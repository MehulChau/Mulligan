import {
  DEFAULT_AERO,
  degToRad,
  makeAeroModel,
  metersToFeet,
  metersToYards,
  mphToMps,
  radToDeg,
  rpmToRadPerSec,
  simulate,
  type AeroParams,
} from "@mulligan/physics";
import { findClub, type ClubId } from "../clubs";
import type { Measurement } from "./measurements";

export interface ClubResidual {
  clubId: ClubId;
  source: string;
  carryErrorYds: number;
  apexErrorFt?: number;
  descentErrorDeg?: number;
}

export interface FitResiduals {
  perClub: ClubResidual[];
  /** Weighted sum of squared relative errors across carry, apex, and descent angle. */
  totalWeightedError: number;
  /**
   * Per-target summary stats, surfaced separately so a fit that improves one
   * target while quietly degrading another can't hide behind a single
   * aggregate number. This is exactly the failure mode the 2026-09-06
   * calibration shipped with: totalWeightedError dropped 0.61 -> 0.097 (a
   * big, reassuring-looking win) while mean carry error *rose* 3.9% -> 6.4%,
   * because descent was weighted 5x and nothing printed carry's own trend.
   * Report and eyeball all four before accepting any future fit.
   */
  meanAbsCarryPct: number;
  maxAbsCarryPct: number;
  meanAbsApexPct: number;
  meanAbsDescentDeg: number;
}

export interface FitWeights {
  carry: number;
  apex: number;
  descent: number;
}

/**
 * carry:8, descent:10 — re-tuned 2026-09-06 after a second-opinion review of
 * the first calibration found it had bought its descent-angle win by
 * regressing carry (see FitResiduals' doc comment above and CLAUDE.md's
 * "Part B rework" section for the full story). This weighting was the best
 * point found on the carry/descent Pareto frontier via a grid search over
 * (carryWeight, descentWeight) subject to spinDecayRate held fixed at
 * PHYSICAL_SPIN_DECAY_RATE (see below) rather than searched: mean carry
 * error ~3.3%, mean descent error ~1.5deg against the 8 sourced
 * measurements. Descent still outweighs carry (10 vs 8) because it's what
 * disambiguates the (CL, CD) pair that carry alone can't (one equation, two
 * unknowns) — but no longer at carry's expense the way 5x did.
 */
export const DEFAULT_FIT_WEIGHTS: FitWeights = { carry: 8, apex: 1, descent: 10 };

/**
 * Golf ball backspin decay in flight is well documented at roughly 3-4% per
 * second (e.g. Bearman & Harvey, and Trackman's own published spin-decay
 * figures) — i.e. spinRate(t) = spinRate(0) * exp(-rate*t) with rate in
 * [0.03, 0.04]. The unconstrained calibration fit initially left this
 * parameter in the search and it landed on a negative value (spin
 * spontaneously *increasing* in flight), which is unphysical regardless of
 * how well it minimised the fit error. A follow-up review showed the
 * "coupling" argument used to justify searching it anyway didn't survive a
 * proper refit: holding this at 0.033 and refitting the other seven costs
 * only ~6-7% in totalWeightedError versus letting it float — nothing close
 * to the ~180% cost a naive (and unfair) "swap one parameter into an
 * already-converged unconstrained fit" comparison suggested. Pinned here
 * and excluded from the search by default; override `fixed` to search it
 * anyway if you have real spin-decay range data to fit it against.
 */
export const PHYSICAL_SPIN_DECAY_RATE = 0.033;

const PARAM_KEYS = [
  "spinRatioCap",
  "liftCoeff",
  "liftExponent",
  "liftCap",
  "dragBase",
  "dragSlope",
  "dragCap",
  "spinDecayRate",
] as const satisfies readonly (keyof AeroParams)[];

function toVector(params: AeroParams, freeKeys: readonly (keyof AeroParams)[]): number[] {
  return freeKeys.map((key) => params[key]);
}

function fromVector(vec: number[], freeKeys: readonly (keyof AeroParams)[], fixed: Partial<AeroParams>): AeroParams {
  const out = { ...fixed } as AeroParams;
  freeKeys.forEach((key, i) => {
    out[key] = vec[i]!;
  });
  return out;
}

function predict(measurement: Measurement, params: AeroParams) {
  const aero = makeAeroModel(params);
  const spinRpm = measurement.spinRpm ?? findClub(measurement.clubId).spinRpm;
  const trajectory = simulate(
    {
      ballSpeed: mphToMps(measurement.ballSpeedMph),
      launchAngle: degToRad(measurement.launchDeg),
      spinRate: rpmToRadPerSec(spinRpm),
      spinAxis: 0,
      startLine: 0,
    },
    { aero },
  );
  return {
    carryYds: metersToYards(trajectory.carry),
    apexFt: metersToFeet(trajectory.apex),
    descentDeg: radToDeg(trajectory.landing.descentAngle),
  };
}

export function computeResiduals(
  measurements: Measurement[],
  params: AeroParams,
  weights: FitWeights = DEFAULT_FIT_WEIGHTS,
): FitResiduals {
  const perClub: ClubResidual[] = [];
  let total = 0;
  let sumAbsCarryPct = 0;
  let maxAbsCarryPct = 0;
  let sumAbsApexPct = 0;
  let apexCount = 0;
  let sumAbsDescentDeg = 0;
  let descentCount = 0;

  for (const measurement of measurements) {
    const predicted = predict(measurement, params);
    const carryErrorYds = predicted.carryYds - measurement.carryYds;
    const apexErrorFt = measurement.apexFt !== undefined ? predicted.apexFt - measurement.apexFt : undefined;
    const descentErrorDeg =
      measurement.descentDeg !== undefined ? predicted.descentDeg - measurement.descentDeg : undefined;

    total += weights.carry * (carryErrorYds / measurement.carryYds) ** 2;
    const absCarryPct = Math.abs(carryErrorYds / measurement.carryYds) * 100;
    sumAbsCarryPct += absCarryPct;
    maxAbsCarryPct = Math.max(maxAbsCarryPct, absCarryPct);

    if (apexErrorFt !== undefined && measurement.apexFt) {
      total += weights.apex * (apexErrorFt / measurement.apexFt) ** 2;
      sumAbsApexPct += Math.abs(apexErrorFt / measurement.apexFt) * 100;
      apexCount++;
    }
    if (descentErrorDeg !== undefined && measurement.descentDeg) {
      total += weights.descent * (descentErrorDeg / measurement.descentDeg) ** 2;
      sumAbsDescentDeg += Math.abs(descentErrorDeg);
      descentCount++;
    }

    perClub.push({
      clubId: measurement.clubId,
      source: measurement.source,
      carryErrorYds,
      apexErrorFt,
      descentErrorDeg,
    });
  }

  return {
    perClub,
    totalWeightedError: total,
    meanAbsCarryPct: measurements.length ? sumAbsCarryPct / measurements.length : 0,
    maxAbsCarryPct,
    meanAbsApexPct: apexCount ? sumAbsApexPct / apexCount : 0,
    meanAbsDescentDeg: descentCount ? sumAbsDescentDeg / descentCount : 0,
  };
}

interface NelderMeadResult {
  x: number[];
  fx: number;
  converged: boolean;
}

/** Minimal derivative-free simplex optimiser — no dependency, ~60 lines. */
function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: { maxIter?: number; tol?: number; initialStep?: number } = {},
): NelderMeadResult {
  const n = x0.length;
  const maxIter = opts.maxIter ?? 4000;
  const tol = opts.tol ?? 1e-10;
  const step = opts.initialStep ?? 0.15;
  const [alpha, gamma, rho, sigma] = [1, 2, 0.5, 0.5];

  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const point = x0.slice();
    point[i] = point[i]! + (point[i] === 0 ? step : point[i]! * step);
    simplex.push(point);
  }
  let values = simplex.map(f);

  let converged = false;
  for (let iter = 0; iter < maxIter; iter++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
    simplex = order.map((i) => simplex[i]!);
    values = order.map((i) => values[i]!);

    if (Math.abs(values[values.length - 1]! - values[0]!) < tol) {
      converged = true;
      break;
    }

    const worst = simplex[simplex.length - 1]!;
    const centroid = new Array(n).fill(0) as number[];
    for (let i = 0; i < simplex.length - 1; i++) {
      for (let j = 0; j < n; j++) centroid[j] = centroid[j]! + simplex[i]![j]! / (simplex.length - 1);
    }

    const reflected = centroid.map((c, j) => c + alpha * (c - worst[j]!));
    const reflectedVal = f(reflected);

    if (reflectedVal < values[0]!) {
      const expanded = centroid.map((c, j) => c + gamma * (reflected[j]! - c));
      const expandedVal = f(expanded);
      if (expandedVal < reflectedVal) {
        simplex[simplex.length - 1] = expanded;
        values[values.length - 1] = expandedVal;
      } else {
        simplex[simplex.length - 1] = reflected;
        values[values.length - 1] = reflectedVal;
      }
    } else if (reflectedVal < values[values.length - 2]!) {
      simplex[simplex.length - 1] = reflected;
      values[values.length - 1] = reflectedVal;
    } else {
      const contracted = centroid.map((c, j) => c + rho * (worst[j]! - c));
      const contractedVal = f(contracted);
      if (contractedVal < values[values.length - 1]!) {
        simplex[simplex.length - 1] = contracted;
        values[values.length - 1] = contractedVal;
      } else {
        for (let i = 1; i < simplex.length; i++) {
          simplex[i] = simplex[0]!.map((c, j) => c + sigma * (simplex[i]![j]! - c));
          values[i] = f(simplex[i]!);
        }
      }
    }
  }

  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  return { x: simplex[order[0]!]!, fx: values[order[0]!]!, converged };
}

function safeObjective(
  measurements: Measurement[],
  vec: number[],
  freeKeys: readonly (keyof AeroParams)[],
  fixed: Partial<AeroParams>,
  weights: FitWeights,
): number {
  try {
    return computeResiduals(measurements, fromVector(vec, freeKeys, fixed), weights).totalWeightedError;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const EMPTY_RESIDUALS: FitResiduals = {
  perClub: [],
  totalWeightedError: 0,
  meanAbsCarryPct: 0,
  maxAbsCarryPct: 0,
  meanAbsApexPct: 0,
  meanAbsDescentDeg: 0,
};

export interface FitOptions {
  weights?: FitWeights;
  /**
   * Parameters held constant during the search (excluded from the
   * Nelder-Mead vector entirely, not just clamped after the fact — a
   * parameter that never enters the search can't be handed an unphysical
   * value by it). Defaults to pinning spinDecayRate at
   * PHYSICAL_SPIN_DECAY_RATE; pass `{}` to search all 8 parameters, or
   * override individual entries if you have real data to fit them against.
   */
  fixed?: Partial<AeroParams>;
  /**
   * Independent Nelder-Mead runs (first from `seed`, the rest from `seed`
   * randomly perturbed +/-20% per free parameter), keeping whichever
   * converges to the lowest objective. A single run can land in a
   * meaningfully worse local minimum than the true best fit — found
   * concretely during the 2026-09-06 rework, where a single-seed pinned
   * refit scored 20% worse than the best of a handful of restarts. Sets no
   * fixed point in stone; more restarts only cost wall-clock time.
   */
  restarts?: number;
}

/**
 * Fits AeroParams to measured range data via Nelder-Mead, minimising a
 * weighted sum of relative errors on carry, apex, and descent angle (see
 * DEFAULT_FIT_WEIGHTS). spinDecayRate is pinned at PHYSICAL_SPIN_DECAY_RATE
 * and excluded from the search by default -- see its doc comment for why.
 */
export function fitAeroParams(
  measurements: Measurement[],
  seed?: Partial<AeroParams>,
  options: FitOptions = {},
): { params: AeroParams; residuals: FitResiduals; converged: boolean } {
  const seedParams: AeroParams = { ...DEFAULT_AERO, ...seed };
  const weights = options.weights ?? DEFAULT_FIT_WEIGHTS;
  const fixed = options.fixed ?? { spinDecayRate: PHYSICAL_SPIN_DECAY_RATE };
  const restarts = options.restarts ?? 6;

  if (measurements.length === 0) {
    return { params: seedParams, residuals: EMPTY_RESIDUALS, converged: true };
  }

  const freeKeys = PARAM_KEYS.filter((key) => !(key in fixed));
  const objective = (vec: number[]) => safeObjective(measurements, vec, freeKeys, fixed, weights);

  let best: NelderMeadResult | undefined;
  for (let attempt = 0; attempt < Math.max(1, restarts); attempt++) {
    const x0 = toVector(seedParams, freeKeys).map((v) => (attempt === 0 ? v : v * (1 + (Math.random() - 0.5) * 0.4)));
    const result = nelderMead(objective, x0);
    if (!best || result.fx < best.fx) best = result;
  }

  const params = fromVector(best!.x, freeKeys, fixed);
  return { params, residuals: computeResiduals(measurements, params, weights), converged: best!.converged };
}
