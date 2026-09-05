import type { Point2, SurfaceType } from "../types";

export type PenaltyKind = "water" | "out";

export interface PenaltyResolution {
  kind: PenaltyKind;
  strokePenalty: number; // always 1 in M2a -- one shot, one stroke on top
  nextBallPos: Point2;
}

/** How far short of the entry point a water drop is placed, yards. Doesn't need to be sophisticated. */
const WATER_DROP_BACK_YDS = 2;

/**
 * Water: one stroke penalty, drop a couple yards back along the line from
 * the previous position toward where the ball entered (a rough stand-in
 * for "nearest point of relief," which is plenty for M2a).
 *
 * Out of bounds: one stroke penalty AND distance -- replay from the
 * previous position, same as real golf's stroke-and-distance rule.
 *
 * Kept as the one place this logic lives, deliberately -- nothing else
 * should be computing drop positions.
 */
export function resolvePenalty(kind: PenaltyKind, previousPos: Point2, restPos: Point2): PenaltyResolution {
  if (kind === "out") {
    return { kind, strokePenalty: 1, nextBallPos: previousPos };
  }

  const dx = previousPos.x - restPos.x;
  const dy = previousPos.y - restPos.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= 0) {
    return { kind, strokePenalty: 1, nextBallPos: restPos };
  }

  const back = Math.min(WATER_DROP_BACK_YDS, distance);
  const nextBallPos: Point2 = {
    x: restPos.x + (dx / distance) * back,
    y: restPos.y + (dy / distance) * back,
  };
  return { kind, strokePenalty: 1, nextBallPos };
}

/** Whether `surface` triggers a penalty at all -- everything else is normal play. */
export function isPenaltySurface(surface: SurfaceType): surface is PenaltyKind {
  return surface === "water" || surface === "out";
}
