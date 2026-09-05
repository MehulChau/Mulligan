/**
 * Auto-resolved putting. No tap-timing minigame, no aiming, no green
 * reading -- the player taps "Putt" and the app reports what happened. At
 * a driving range you are not putting; this model exists so a hole can
 * produce a score, not so putting can be a game in its own right.
 */

import type { SurfaceType } from "../types";

/**
 * A true fringe distance -- close enough to the pin that putting from just
 * off the green is a normal shot choice, not a concession.
 *
 * M2a briefly widened this to 65 yards as a workaround: the bag bottomed
 * out at the lob wedge's fixed full-swing carry (~77 yards), so anywhere
 * from a few yards to ~70 yards out, every available club overshot the pin
 * -- a real dead end, confirmed by Monte Carlo simulation, that made
 * ~10-25% of rounds never finish. But routing that whole zone through the
 * putting model meant asking a curve calibrated out to 60 feet to resolve
 * shots out to 195 feet -- a flat ~3-stroke toll with a ~0.02% hole-out
 * chance, not a putt. The score distribution still looked healthy, which is
 * what made it dangerous: it quietly deleted the short game, the exact shot
 * this product exists to serve.
 *
 * M2a.1 closed the gap for real with partial-swing wedges (`swingFraction`
 * in `@mulligan/shot-source`), so this constant is back to an actual
 * fringe. See CLAUDE.md's M2a.1 section for the full story.
 */
export const FRINGE_PUTTING_DISTANCE_YDS = 5;

/** Whether the ball can be putted from here: on the green, or close enough to the pin regardless of surface. */
export function isPuttable(restSurface: SurfaceType, distanceToPinYds: number): boolean {
  if (restSurface === "green") return true;
  return distanceToPinYds <= FRINGE_PUTTING_DISTANCE_YDS;
}

export interface PuttResult {
  holed: boolean;
  distanceBefore: number; // yards
  distanceAfter: number; // yards, 0 if holed
}

export interface PuttingAnchor {
  distanceYds: number;
  probability: number;
}

export interface PuttingParams {
  /** Sorted ascending by distance. Tune these against real makes, not the interpolation logic. */
  anchors: PuttingAnchor[];
  /** Exponential decay rate (per yard) applied beyond the last anchor. */
  tailDecayPerYd: number;
  /** On a miss, the leave distance's base fraction of the putt length. */
  missLeaveFraction: number;
  /** On a miss, additional random fraction (0..this) of the putt length, on top of the base fraction. */
  missLeaveJitterFraction: number;
  /** On a miss, the leave distance is never shorter than this (yards) -- even a lag putt leaves something. */
  missLeaveFloorYds: number;
}

// Anchors from the M2a spec's table (feet -> yards): 1ft ~0.99, 3ft ~0.90,
// 6ft ~0.65, 10ft ~0.40, 20ft ~0.15, 30ft ~0.07, 60ft ~0.02. Approximate
// targets, not gospel -- tuning this is a data change, not a code change.
export const PUTTING_PARAMS: PuttingParams = {
  anchors: [
    { distanceYds: 1 / 3, probability: 0.99 },
    { distanceYds: 1, probability: 0.9 },
    { distanceYds: 2, probability: 0.65 },
    { distanceYds: 10 / 3, probability: 0.4 },
    { distanceYds: 20 / 3, probability: 0.15 },
    { distanceYds: 10, probability: 0.07 },
    { distanceYds: 20, probability: 0.02 },
  ],
  tailDecayPerYd: 0.12,
  missLeaveFraction: 0.08,
  missLeaveJitterFraction: 0.1,
  missLeaveFloorYds: 1 / 6, // 6 inches
};

/**
 * Probability of holing a putt from `distanceYds`. Piecewise-linear between
 * the anchor points, flat below the first anchor, exponential decay beyond
 * the last -- monotonically non-increasing and in [0, 1] for any input,
 * including 0 and absurdly large distances.
 */
export function makeProbability(distanceYds: number): number {
  const { anchors, tailDecayPerYd } = PUTTING_PARAMS;
  const d = Math.max(0, distanceYds);

  const first = anchors[0]!;
  if (d <= first.distanceYds) return first.probability;

  const last = anchors[anchors.length - 1]!;
  if (d >= last.distanceYds) {
    return last.probability * Math.exp(-tailDecayPerYd * (d - last.distanceYds));
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (d >= a.distanceYds && d <= b.distanceYds) {
      const t = (d - a.distanceYds) / (b.distanceYds - a.distanceYds);
      return a.probability + (b.probability - a.probability) * t;
    }
  }
  return last.probability; // unreachable given the checks above
}

/**
 * Resolves one putt attempt. Pure given `rng`; use a mulberry32-seeded
 * generator (same approach as SimulatedShotSource) for a reproducible
 * putting sequence.
 */
export function resolvePutt(distanceYds: number, rng: () => number): PuttResult {
  if (distanceYds <= 0) {
    return { holed: true, distanceBefore: 0, distanceAfter: 0 };
  }

  const probability = makeProbability(distanceYds);
  if (rng() < probability) {
    return { holed: true, distanceBefore: distanceYds, distanceAfter: 0 };
  }

  const { missLeaveFraction, missLeaveJitterFraction, missLeaveFloorYds } = PUTTING_PARAMS;
  const fraction = missLeaveFraction + missLeaveJitterFraction * rng();
  const raw = Math.max(missLeaveFloorYds, distanceYds * fraction);
  // Never as long as (let alone longer than) the putt itself, regardless of
  // how the floor/jitter above land for a very short putt.
  const distanceAfter = Math.min(raw, distanceYds * 0.95);

  return { holed: false, distanceBefore: distanceYds, distanceAfter };
}

/** Safety valve -- an amateur golfer picks up after this many putts; nothing loops forever. */
export const MAX_PUTTS = 5;

/**
 * Putts out from `distanceYds`, one resolvePutt() call per attempt, capped
 * at MAX_PUTTS. Used for simulation/testing (Monte Carlo rounds, "does this
 * ever hang" checks) -- the interactive game resolves one putt per tap
 * itself and applies the same cap at the UI layer.
 */
export function holeOutPutting(
  distanceYds: number,
  rng: () => number,
  maxPutts: number = MAX_PUTTS,
): { putts: PuttResult[]; strokes: number } {
  const putts: PuttResult[] = [];
  let remaining = distanceYds;

  while (putts.length < maxPutts) {
    const result = resolvePutt(remaining, rng);
    putts.push(result);
    if (result.holed) break;
    remaining = result.distanceAfter;
  }

  return { putts, strokes: putts.length };
}
