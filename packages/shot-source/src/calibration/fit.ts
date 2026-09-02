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
}

// Descent angle drives rollout and stopping power — the whole feel of iron
// play — and it's what disambiguates the (CL, CD) pair that carry alone
// can't (one equation, two unknowns). Weight it heavily.
const WEIGHTS = { carry: 1, apex: 1, descent: 5 };

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

function toVector(params: AeroParams): number[] {
  return PARAM_KEYS.map((key) => params[key]);
}

function fromVector(vec: number[]): AeroParams {
  const out = {} as AeroParams;
  PARAM_KEYS.forEach((key, i) => {
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

export function computeResiduals(measurements: Measurement[], params: AeroParams): FitResiduals {
  const perClub: ClubResidual[] = [];
  let total = 0;

  for (const measurement of measurements) {
    const predicted = predict(measurement, params);
    const carryErrorYds = predicted.carryYds - measurement.carryYds;
    const apexErrorFt = measurement.apexFt !== undefined ? predicted.apexFt - measurement.apexFt : undefined;
    const descentErrorDeg =
      measurement.descentDeg !== undefined ? predicted.descentDeg - measurement.descentDeg : undefined;

    total += WEIGHTS.carry * (carryErrorYds / measurement.carryYds) ** 2;
    if (apexErrorFt !== undefined && measurement.apexFt) {
      total += WEIGHTS.apex * (apexErrorFt / measurement.apexFt) ** 2;
    }
    if (descentErrorDeg !== undefined && measurement.descentDeg) {
      total += WEIGHTS.descent * (descentErrorDeg / measurement.descentDeg) ** 2;
    }

    perClub.push({
      clubId: measurement.clubId,
      source: measurement.source,
      carryErrorYds,
      apexErrorFt,
      descentErrorDeg,
    });
  }

  return { perClub, totalWeightedError: total };
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

function safeObjective(measurements: Measurement[], vec: number[]): number {
  try {
    return computeResiduals(measurements, fromVector(vec)).totalWeightedError;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Fits AeroParams to measured range data via Nelder-Mead over the 8
 * parameters, minimising a weighted sum of relative errors on carry, apex,
 * and descent angle (descent weighted heavily — see WEIGHTS above).
 */
export function fitAeroParams(
  measurements: Measurement[],
  seed?: Partial<AeroParams>,
): { params: AeroParams; residuals: FitResiduals; converged: boolean } {
  const seedParams: AeroParams = { ...DEFAULT_AERO, ...seed };

  if (measurements.length === 0) {
    return { params: seedParams, residuals: { perClub: [], totalWeightedError: 0 }, converged: true };
  }

  const result = nelderMead((vec) => safeObjective(measurements, vec), toVector(seedParams));
  const params = fromVector(result.x);

  return { params, residuals: computeResiduals(measurements, params), converged: result.converged };
}
