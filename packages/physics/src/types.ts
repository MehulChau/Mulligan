/**
 * Coordinate frame (right-handed, origin at the ball at address):
 *   x — downrange, along the target line. Positive = further from the golfer.
 *   y — vertical. Positive = up.
 *   z — lateral. Positive = right of the target line (golfer's view).
 * A fade/slice (right-hander) lands at +z; a draw/hook lands at -z.
 * Positive spinAxis tilts the spin axis to curve toward +z (fade/right).
 * Positive startLine launches the ball toward +z (right of target).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** All SI. This is what the integrator consumes. */
export interface LaunchConditions {
  ballSpeed: number; // m/s
  launchAngle: number; // radians, above horizontal
  spinRate: number; // rad/s
  spinAxis: number; // radians; +ve tilts toward +z (fade), -ve toward -z (draw)
  startLine: number; // radians; +ve is right of target line
  launchHeight?: number; // m above ground, default 0 (a teed driver could be ~0.03)
}

export interface TrajectoryPoint {
  x: number;
  y: number;
  z: number; // m
  t: number; // s
}

export interface LandingState {
  position: Vec3; // m, y === 0 exactly
  velocity: Vec3; // m/s at ground contact
  speed: number; // m/s, magnitude
  descentAngle: number; // radians below horizontal, always positive
  spinRate: number; // rad/s remaining at landing
  spinAxis: number; // radians, unchanged from launch
}

export interface Trajectory {
  points: TrajectoryPoint[]; // uniform shape, includes origin, terminates exactly at y = 0
  landing: LandingState;
  apex: number; // m
  flightTime: number; // s
  carry: number; // m, downrange distance (x) at landing
  lateral: number; // m, z at landing
}
