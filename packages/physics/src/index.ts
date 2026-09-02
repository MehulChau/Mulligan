export type { Vec3, LaunchConditions, TrajectoryPoint, LandingState, Trajectory } from "./types";
export {
  GRAVITY,
  AIR_DENSITY,
  BALL_MASS,
  BALL_DIAMETER,
  BALL_RADIUS,
  BALL_CROSS_SECTIONAL_AREA,
  DRAG_LIFT_CONSTANT,
  mphToMps,
  mpsToMph,
  metersToYards,
  yardsToMeters,
  metersToFeet,
  feetToMeters,
  degToRad,
  radToDeg,
  rpmToRadPerSec,
  radPerSecToRpm,
} from "./constants";
export type { AeroParams, AeroModel } from "./aero";
export { DEFAULT_AERO, makeAeroModel } from "./aero";
export type { SimulateOptions } from "./integrate";
export { simulate, computeSpinAxis, magnusKinematics } from "./integrate";
