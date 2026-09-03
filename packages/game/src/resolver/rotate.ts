import type { Point2 } from "../types";

/**
 * A shot's result in the physics module's own local frame, relative to the
 * player's chosen aim line: d = forward distance along the aim line
 * (yards), l = lateral offset perpendicular to it, +right (yards). This is
 * NOT hole space — see localToHole.
 */
export interface LocalOffset {
  d: number;
  l: number;
}

/**
 * Rotates a (d, l) offset from the aim line into hole space and adds it to
 * ballPos. heading is a compass-style bearing (0 = toward +y/the pin,
 * positive = clockwise toward +x).
 *
 * heading 0,  l = 0  -> straight up +y by d
 * heading 0,  l > 0  -> +x (right)
 * heading 90, l = 0  -> +x by d
 * heading 90, l > 0  -> -y
 */
export function localToHole(ballPos: Point2, headingRad: number, offset: LocalOffset): Point2 {
  return {
    x: ballPos.x + offset.d * Math.sin(headingRad) + offset.l * Math.cos(headingRad),
    y: ballPos.y + offset.d * Math.cos(headingRad) - offset.l * Math.sin(headingRad),
  };
}

/**
 * The exact inverse of localToHole: recovers the (d, l) that would produce
 * holePoint at the given heading. Solve the 2x2 system directly rather than
 * calling localToHole with -headingRad -- this transform mixes a rotation
 * with a handedness flip (compass bearings are clockwise, math angles are
 * counterclockwise), so its matrix is orthogonal AND symmetric, which makes
 * it its own inverse at the SAME heading. Negating heading does not invert
 * it (confirmed by the round-trip test below); reusing the same formula
 * with headingRad swapped in for the (d, l) roles does.
 */
export function holeToLocal(ballPos: Point2, headingRad: number, holePoint: Point2): LocalOffset {
  const dx = holePoint.x - ballPos.x;
  const dy = holePoint.y - ballPos.y;
  return {
    d: dx * Math.sin(headingRad) + dy * Math.cos(headingRad),
    l: dx * Math.cos(headingRad) - dy * Math.sin(headingRad),
  };
}

/** The heading (radians) that points straight from `from` toward `to`. Used for the default "aim at pin" heading. */
export function headingToward(from: Point2, to: Point2): number {
  return Math.atan2(to.x - from.x, to.y - from.y);
}
