import type { Hole } from "./types";
import hole1Data from "./holes/hole-1.json";
import hole2Data from "./holes/hole-2.json";
import hole3Data from "./holes/hole-3.json";
import hole4Data from "./holes/hole-4.json";
import hole5Data from "./holes/hole-5.json";
import hole6Data from "./holes/hole-6.json";

export type { Point2, SurfaceType, SurfacePolygon, Hole } from "./types";
export { pointInPolygon, surfaceAt } from "./surface";

export type { LocalOffset } from "./resolver/rotate";
export { localToHole, holeToLocal, headingToward } from "./resolver/rotate";
export type { RolloutSurface, SurfaceRolloutParams } from "./resolver/rollout";
export { DEFAULT_SURFACE_ROLLOUT, estimateRollout } from "./resolver/rollout";
export type { ShotResult } from "./resolver/resolveShot";
export { resolveShot } from "./resolver/resolveShot";

export type { PuttResult, PuttingAnchor, PuttingParams } from "./putting/putting";
export { PUTTING_PARAMS, makeProbability, resolvePutt, MAX_PUTTS, holeOutPutting, FRINGE_PUTTING_DISTANCE_YDS, isPuttable } from "./putting/putting";

export type { ClubAvailability } from "./rules/clubAvailability";
export { clubAvailability, lieRestrictionSummary, firstAvailableClub } from "./rules/clubAvailability";

export type { PenaltyKind, PenaltyResolution } from "./rules/penalty";
export { resolvePenalty, isPenaltySurface } from "./rules/penalty";

export type { ScoreBreakdown } from "./rules/scoring";
export { scoreToParLabel, summarizeScore } from "./rules/scoring";

export const HOLE_1: Hole = hole1Data as Hole;

/**
 * The six-hole course (Part B). Order is the play order: two par 3s, three
 * par 4s, one par 5 (par 4/3/4/5/4/3 = 23), each authored to ask a
 * different question rather than repeat HOLE_1's shape -- see
 * docs/playtest-findings.md (HOLE_1 alone) and docs/course-playtest-findings.md
 * (all six) for what each one was verified to actually do under the Part A
 * harness. HOLE_1 ("The Bend") stays first and unmodified -- Part A's own
 * finding was not a defect to patch, it's a data point the other five holes
 * were built to not repeat.
 */
export const COURSE: readonly Hole[] = [
  hole1Data as Hole,
  hole2Data as Hole,
  hole3Data as Hole,
  hole4Data as Hole,
  hole5Data as Hole,
  hole6Data as Hole,
];
