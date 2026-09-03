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

/** Alternate shade for fairway mowing stripes — subtle, same hue, slightly lighter/darker. */
export const FAIRWAY_STRIPE_LIGHT = "#22764C";
export const FAIRWAY_STRIPE_DARK = "#1A5F3B";
export const BUNKER_STIPPLE = "rgba(255,255,255,0.35)";
export const WATER_SHIMMER = "rgba(255,255,255,0.12)";

export const BALL_TRACE_COLOR = "#C9862B"; // sand-amber, matches flight-lab.html
export const BALL_TRACE_GLOW = "rgba(201,134,43,0.28)";
export const CANVAS_BG = "#EAE6DA"; // sage, matches flight-lab.html --bg family
export const PIN_FLAG_COLOR = "#F4F1E8";
export const PIN_POLE_COLOR = "#1C2721";
export const PIN_CUP_COLOR = "#0D3B25";
export const BALL_FILL = "#FFFFFF";
export const BALL_STROKE = "rgba(0,0,0,0.35)";
export const BALL_SHADOW = "rgba(13,59,37,0.35)";
export const AIM_LINE_COLOR = "rgba(255,255,255,0.8)";
export const LANDING_MARK_COLOR = "rgba(255,255,255,0.85)";
export const PREVIOUS_TRACE_ALPHA = 0.3;
