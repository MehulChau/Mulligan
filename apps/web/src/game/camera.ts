import type { Hole, Point2 } from "@mulligan/game";

/**
 * One static fitted view — no pan/zoom in M1. Fits the hole's bounds into
 * the viewport preserving aspect ratio, pin at the top, tee at the bottom.
 * yardsToScreen/screenToYards are the ONLY place this transform happens.
 */
export interface Camera {
  scale: number; // screen px per yard
  offsetX: number;
  offsetY: number;
}

export function computeCamera(hole: Hole, viewportWidth: number, viewportHeight: number, marginPx = 28): Camera {
  const holeWidth = hole.bounds.maxX - hole.bounds.minX;
  const holeHeight = hole.bounds.maxY - hole.bounds.minY;
  const usableW = Math.max(1, viewportWidth - marginPx * 2);
  const usableH = Math.max(1, viewportHeight - marginPx * 2);
  const scale = Math.min(usableW / holeWidth, usableH / holeHeight);

  const scaledW = holeWidth * scale;
  const scaledH = holeHeight * scale;
  const extraX = (viewportWidth - scaledW) / 2;
  const extraY = (viewportHeight - scaledH) / 2;

  return {
    scale,
    offsetX: extraX - hole.bounds.minX * scale,
    offsetY: extraY + hole.bounds.maxY * scale,
  };
}

export function yardsToScreen(camera: Camera, p: Point2): Point2 {
  return {
    x: camera.offsetX + p.x * camera.scale,
    y: camera.offsetY - p.y * camera.scale,
  };
}

export function screenToYards(camera: Camera, p: Point2): Point2 {
  return {
    x: (p.x - camera.offsetX) / camera.scale,
    y: (camera.offsetY - p.y) / camera.scale,
  };
}
