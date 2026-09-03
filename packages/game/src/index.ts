import type { Hole } from "./types";
import hole1Data from "./holes/hole-1.json";

export type { Point2, SurfaceType, SurfacePolygon, Hole } from "./types";
export { pointInPolygon, surfaceAt } from "./surface";

export type { LocalOffset } from "./resolver/rotate";
export { localToHole, holeToLocal } from "./resolver/rotate";
export { estimateRollout } from "./resolver/rollout";
export type { ShotResult } from "./resolver/resolveShot";
export { resolveShot } from "./resolver/resolveShot";

export const HOLE_1: Hole = hole1Data as Hole;
