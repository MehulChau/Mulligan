import type { Hole, Point2, SurfaceType } from "./types";

/** Ray casting — no dependency. Edge behavior is not guaranteed either way. */
export function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const crosses = pi.y > point.y !== pj.y > point.y;
    const x = ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (crosses && point.x < x) inside = !inside;
  }
  return inside;
}

/**
 * Topmost painted surface containing `point` (surfaces are checked in
 * reverse array order, so later entries win). Outside the hole's bounds is
 * 'out'; inside the bounds but not in any polygon is 'rough'.
 */
export function surfaceAt(hole: Hole, point: Point2): SurfaceType {
  const { bounds } = hole;
  if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) {
    return "out";
  }
  for (let i = hole.surfaces.length - 1; i >= 0; i--) {
    const surface = hole.surfaces[i]!;
    if (pointInPolygon(point, surface.points)) return surface.type;
  }
  return "rough";
}
