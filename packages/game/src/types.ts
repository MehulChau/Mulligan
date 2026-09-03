/**
 * Hole space (NOT the physics module's coordinate frame): 2D, in yards,
 * origin at the tee.
 *   x — lateral, positive to the right when standing on the tee looking at the pin
 *   y — downrange, positive toward the pin
 * Physics uses x downrange, y up, z lateral — converting between the two
 * frames is isolated to a single function (see shot placement).
 */
export interface Point2 {
  x: number;
  y: number;
}

export type SurfaceType = "tee" | "fairway" | "green" | "rough" | "bunker" | "water" | "out";

export interface SurfacePolygon {
  type: SurfaceType;
  /** Closed implicitly (last point connects back to the first), wound consistently. */
  points: Point2[];
}

export interface Hole {
  id: string;
  name: string;
  par: number;
  tee: Point2; // yards, should be {x: 0, y: 0}
  pin: Point2; // yards
  /** Painted in array order — later entries render/resolve on top. */
  surfaces: SurfacePolygon[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}
