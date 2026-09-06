import type { SurfaceType } from "@mulligan/game";

/** Human-readable surface names -- shared by DistanceHero, HoleCanvas's target-marker readout, and App.tsx's screen-reader narration, so the three never drift apart. */
export const SURFACE_LABEL: Record<SurfaceType, string> = {
  tee: "Tee",
  fairway: "Fairway",
  rough: "Rough",
  green: "Green",
  bunker: "Bunker",
  water: "Water",
  out: "Out of bounds",
};
