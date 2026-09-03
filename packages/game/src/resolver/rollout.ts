import { mpsToMph, radToDeg, type LandingState } from "@mulligan/physics";

/**
 * PLACEHOLDER -- surface-agnostic. M2 replaces this with a per-surface
 * model (fairway runs, rough checks up, bunkers barely move, etc). Every
 * rollout decision lives in this one function so that M2 is a one-file
 * change; do not let rollout logic leak into resolveShot or the renderer.
 *
 * Crude heuristic, not physically rigorous: a shallower descent and a
 * faster landing speed both mean more of the ball's energy carries forward
 * along the ground instead of being absorbed on impact, so both increase
 * roll. Clamped to a plausible range.
 */
export function estimateRollout(landing: LandingState): number {
  const descentDeg = radToDeg(landing.descentAngle);
  const speedMph = mpsToMph(landing.speed);

  const steepnessFactor = Math.max(0, 1 - descentDeg / 55);
  const speedFactor = speedMph / 60;
  const rolloutYds = 18 * steepnessFactor * speedFactor;

  return Math.max(0, Math.min(35, rolloutYds));
}
