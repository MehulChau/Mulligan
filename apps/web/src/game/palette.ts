import type { SurfaceType } from "@mulligan/game";

/**
 * Fixed scene colors for the hole canvas — deliberately NOT theme-swapped,
 * same precedent as flight-lab.html's side/top view ("self-contained scene,
 * works in both themes"). Fairway/amber/Archivo lineage carried forward
 * from the flight-lab.html CSS custom properties (--green #1E6B44, --amber
 * #C9862B); surface colors below are new, same family.
 */
export const SURFACE_COLORS: Record<SurfaceType, string> = {
  tee: "#1E6B44",
  fairway: "#1E6B44",
  rough: "#35492E",
  green: "#4FA36A",
  bunker: "#D8B274",
  water: "#4A7A93",
  out: "#EAE6DA",
};

export const BALL_TRACE_COLOR = "#C9862B"; // sand-amber, matches flight-lab.html
export const CANVAS_BG = "#EAE6DA"; // sage, matches flight-lab.html --bg family
export const PIN_FLAG_COLOR = "#FFFFFF";
export const PIN_POLE_COLOR = "#1C2721";
export const BALL_FILL = "#FFFFFF";
export const BALL_STROKE = "rgba(0,0,0,0.35)";
export const AIM_LINE_COLOR = "rgba(255,255,255,0.75)";
export const PREVIOUS_TRACE_ALPHA = 0.32;
