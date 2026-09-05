import type { Hole } from "./types";
import hole1Data from "./holes/hole-1.json";

export type { Point2, SurfaceType, SurfacePolygon, Hole } from "./types";
export { pointInPolygon, surfaceAt } from "./surface";

export type { LocalOffset } from "./resolver/rotate";
export { localToHole, holeToLocal, headingToward } from "./resolver/rotate";
export { estimateRollout } from "./resolver/rollout";
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
