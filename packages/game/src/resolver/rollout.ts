import { mpsToMph, radPerSecToRpm, radToDeg, type LandingState } from "@mulligan/physics";
import { surfaceAt } from "../surface";
import type { Hole, Point2, SurfaceType } from "../types";

/**
 * M2b: the surface-aware rollout model, replacing the M1 placeholder.
 * Blocked until Part B's aero calibration made descent angle actually vary
 * across the bag (before: ~43-44deg for every club, so this model would
 * have had nothing real to respond to) -- see CLAUDE.md's Part B/C
 * sections. Every rollout decision still lives in this one file, per the
 * M1 design note this replaces.
 *
 * Crude but directionally real, not a rigorous bounce/roll physics
 * simulation: a shallower landing angle and a faster landing speed both
 * mean more of the ball's momentum carries forward along the ground
 * rather than being absorbed vertically on impact, and heavy backspin
 * "checks" (grabs and stops) the ball hard on a firm, mown surface --
 * dramatically on a green, less so on fairway, barely at all once the
 * ball is tumbling through rough or plowing into sand.
 */

export interface SurfaceRolloutParams {
  /**
   * How much of the landing-condition-driven "roll budget" actually
   * converts to ground distance on this surface, relative to fairway's
   * baseline (1.0). Lower = the surface eats momentum faster: a bunker
   * should stop a ball almost on contact, rough should check it quickly,
   * a green is firm but very short-mown so it splits the difference.
   */
  rolloutMultiplier: number;
  /**
   * How strongly backspin fights the roll on this surface, 0-1. A firm
   * green is where backspin does its most dramatic work (a well-struck
   * wedge can back up); loose rough or sand absorbs spin variation in the
   * turf/sand itself, so spin barely changes the outcome there.
   */
  spinCheckStrength: number;
}

export type RolloutSurface = "fairway" | "green" | "rough" | "bunker";

/**
 * Named and tunable, same posture as AeroParams/DispersionParams --
 * placeholder numbers chosen to land in a plausible range (see the sanity
 * targets in CLAUDE.md's Part C section: driver-on-fairway ~15-25yd,
 * mid-iron ~5-10yd, wedge-on-green ~1-3yd), not fit against real rollout
 * data, which doesn't exist yet. Tightening these is a data change once
 * it does, not a code change.
 */
export const DEFAULT_SURFACE_ROLLOUT: Record<RolloutSurface, SurfaceRolloutParams> = {
  fairway: { rolloutMultiplier: 1.0, spinCheckStrength: 0.45 },
  // Green's base multiplier is close to fairway's (a short, firm, mown
  // surface is genuinely low-friction -- it's why putts roll so far) but
  // real approach shots land on it with much heavier backspin than a
  // fairway shot ever carries, and that's what actually keeps a green
  // shot short: the spin check, not the surface being "sticky" per se.
  green: { rolloutMultiplier: 0.85, spinCheckStrength: 0.7 },
  rough: { rolloutMultiplier: 0.32, spinCheckStrength: 0.12 },
  bunker: { rolloutMultiplier: 0.1, spinCheckStrength: 0.05 },
};

/** Any surface not in DEFAULT_SURFACE_ROLLOUT (tee, water, out) rolls out like fairway -- rollout magnitude doesn't matter there; penalty resolution overrides the ball's position anyway. */
const FALLBACK_ROLLOUT_PARAMS: SurfaceRolloutParams = DEFAULT_SURFACE_ROLLOUT.fairway;

// Tuned against this game's actual calibrated CLUBS trajectories (real
// simulate() landing speed/angle per club, not hand-picked synthetic
// values) so a full driver on fairway lands in the ~15-25yd sanity range
// from CLAUDE.md. Post-calibration landing speeds are much slower than
// launch speed -- a driver launched at 150mph lands around 58mph, a lob
// wedge around 42mph -- so this constant is set against that real range,
// not against an assumed "fast landing" figure.
const BASE_ROLLOUT_SCALE_YDS = 76;
const MAX_ROLLOUT_YDS = 45;
const ROLLOUT_STEP_YDS = 0.5;
const MIN_EFFECTIVE_MULTIPLIER = 0.02; // floor, so a near-zero multiplier/spin-check combo can't produce a division blow-up
const SPIN_CHECK_REFERENCE_RPM = 11000; // roughly the spin ceiling CLUBS/measured shots ever produce; spin-check saturates near here

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Surface-aware rollout distance (yards) from a physics landing state.
 * Steps the roll forward in small increments, re-checking which surface
 * the ball is over at each step -- a drive landing on fairway that would
 * run into rough stops where the rough stops it, not at the full fairway
 * distance, because the moment it crosses the boundary the per-yard cost
 * of continuing jumps to rough's (lower) multiplier.
 *
 * `landingHolePos` and `rollDirection` (a unit vector, hole-space
 * downrange/lateral) are needed here -- not just `landing` -- because
 * checking the surface at each step requires knowing where on the hole
 * the ball actually is; `resolveShot` already computes both for its own
 * `rest` calculation, so this reuses them rather than recomputing.
 */
export function estimateRollout(
  landing: LandingState,
  hole: Hole,
  landingHolePos: Point2,
  rollDirection: { d: number; l: number },
  params: Record<RolloutSurface, SurfaceRolloutParams> = DEFAULT_SURFACE_ROLLOUT,
): number {
  const descentDeg = radToDeg(landing.descentAngle);
  const speedMph = mpsToMph(landing.speed);
  const spinRpm = radPerSecToRpm(landing.spinRate);

  const steepnessFactor = clamp(1 - descentDeg / 55, 0, 1);
  const speedFactor = speedMph / 60;
  // "Fairway-equivalent yards of roll this landing has earned" -- the
  // budget that gets spent, at a per-surface exchange rate, as the ball
  // actually travels.
  let energy = BASE_ROLLOUT_SCALE_YDS * steepnessFactor * speedFactor;

  let traveledYds = 0;

  while (energy > 1e-3 && traveledYds < MAX_ROLLOUT_YDS) {
    const pointHere: Point2 = {
      x: landingHolePos.x + traveledYds * rollDirection.l,
      y: landingHolePos.y + traveledYds * rollDirection.d,
    };
    const surface = surfaceAt(hole, pointHere);
    const surfaceParams = (params as Partial<Record<SurfaceType, SurfaceRolloutParams>>)[surface] ?? FALLBACK_ROLLOUT_PARAMS;

    const spinCheckFactor = 1 - clamp(spinRpm / SPIN_CHECK_REFERENCE_RPM, 0, 1) * surfaceParams.spinCheckStrength;
    const effectiveMultiplier = Math.max(surfaceParams.rolloutMultiplier * spinCheckFactor, MIN_EFFECTIVE_MULTIPLIER);
    const costPerYard = 1 / effectiveMultiplier;

    const energyForFullStep = ROLLOUT_STEP_YDS * costPerYard;
    if (energyForFullStep <= energy) {
      traveledYds += ROLLOUT_STEP_YDS;
      energy -= energyForFullStep;
    } else {
      traveledYds += energy / costPerYard;
      energy = 0;
    }
  }

  return clamp(traveledYds, 0, MAX_ROLLOUT_YDS);
}
