import type { Point2 } from "@mulligan/game";

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * One static fitted view — no pan/zoom in M1. Fits `bounds` into the
 * viewport preserving aspect ratio, pin at the top, tee at the bottom.
 * yardsToScreen/screenToYards are the ONLY place this transform happens --
 * which is also why left-handed mode (Part C) is a one-field addition here
 * rather than a change scattered across every draw call: `mirrorX` flips
 * the x-axis at this single seam, and every caller (surfaces, pin, ball,
 * previous shots, drag-to-aim's screenToYards) gets it for free.
 */
export interface Camera {
  scale: number; // screen px per yard
  offsetX: number;
  offsetY: number;
  mirrorX: boolean;
}

export function computeCamera(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  marginPx = 28,
  mirrorX = false,
): Camera {
  // Mirroring flips which physical x is "left" on screen -- computed here
  // (not by negating x in yardsToScreen alone) so the fitted extent and
  // centering are correct for the mirrored layout too, not just individual
  // point positions.
  const effMinX = mirrorX ? -bounds.maxX : bounds.minX;
  const effMaxX = mirrorX ? -bounds.minX : bounds.maxX;
  const holeWidth = effMaxX - effMinX;
  const holeHeight = bounds.maxY - bounds.minY;
  const usableW = Math.max(1, viewportWidth - marginPx * 2);
  const usableH = Math.max(1, viewportHeight - marginPx * 2);
  const scale = Math.min(usableW / holeWidth, usableH / holeHeight);

  const scaledW = holeWidth * scale;
  const scaledH = holeHeight * scale;
  const extraX = (viewportWidth - scaledW) / 2;
  const extraY = (viewportHeight - scaledH) / 2;

  return {
    scale,
    offsetX: extraX - effMinX * scale,
    offsetY: extraY + bounds.maxY * scale,
    mirrorX,
  };
}

/**
 * Grows `bounds` (a hole's authored bounds) just enough to keep every point
 * in `points` inside frame -- a wayward shot (wild dispersion, or a manual
 * entry with an extreme spin axis) can land outside the hole's authored
 * bounds, and the ball must never render off-canvas. Still one static
 * fitted view per frame, just computed to include what actually needs to
 * be visible instead of only the hole's nominal extent.
 */
export function effectiveBounds(bounds: Bounds, points: Point2[], paddingYds = 8): Bounds {
  let { minX, maxX, minY, maxY } = bounds;
  for (const p of points) {
    if (p.x < minX) minX = p.x - paddingYds;
    if (p.x > maxX) maxX = p.x + paddingYds;
    if (p.y < minY) minY = p.y - paddingYds;
    if (p.y > maxY) maxY = p.y + paddingYds;
  }
  return { minX, maxX, minY, maxY };
}

export function yardsToScreen(camera: Camera, p: Point2): Point2 {
  const x = camera.mirrorX ? -p.x : p.x;
  return {
    x: camera.offsetX + x * camera.scale,
    y: camera.offsetY - p.y * camera.scale,
  };
}

export function screenToYards(camera: Camera, p: Point2): Point2 {
  const x = (p.x - camera.offsetX) / camera.scale;
  return {
    x: camera.mirrorX ? -x : x,
    y: (camera.offsetY - p.y) / camera.scale,
  };
}
