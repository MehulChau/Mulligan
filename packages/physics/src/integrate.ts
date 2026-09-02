import { BALL_RADIUS, DRAG_LIFT_CONSTANT, GRAVITY } from "./constants";
import { DEFAULT_AERO, makeAeroModel, type AeroModel } from "./aero";
import type { LandingState, LaunchConditions, Trajectory, TrajectoryPoint, Vec3 } from "./types";

export interface SimulateOptions {
  /** Integration step, seconds. Default 0.004s — verified within 0.1% of converged (see M0 notes). */
  dt?: number;
  /** Safety cap on flight time so a pathological input can't hang the app. */
  maxTime?: number;
  /** Safety cap on iteration count, alongside maxTime. */
  maxSteps?: number;
  aero?: AeroModel;
}

const DEFAULT_DT = 0.004; // s
const DEFAULT_MAX_TIME = 15; // s
const DEFAULT_MAX_STEPS = 100_000;

interface FlightState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinRate: number;
  t: number;
}

/**
 * Unit spin-axis vector built in the frame of the launch direction, so it
 * stays perpendicular to the initial velocity for every combination of
 * spin-axis tilt and start line (the launch-frame fix — see M0 notes).
 */
export function computeSpinAxis(spinAxis: number, startLine: number): Vec3 {
  return {
    x: -Math.cos(spinAxis) * Math.sin(startLine),
    y: -Math.sin(spinAxis),
    z: Math.cos(spinAxis) * Math.cos(startLine),
  };
}

/**
 * Magnus lift direction (axis × velocity, unit) and sinTheta = the sine of
 * the angle between the spin axis and the velocity vector. Lift magnitude
 * must scale by sinTheta — a spin component parallel to velocity produces no
 * Magnus force. For a unit axis, sinTheta === |axis × v| / |v|.
 */
export function magnusKinematics(axis: Vec3, velocity: Vec3): { liftDir: Vec3; sinTheta: number } {
  const cross: Vec3 = {
    x: axis.y * velocity.z - axis.z * velocity.y,
    y: axis.z * velocity.x - axis.x * velocity.z,
    z: axis.x * velocity.y - axis.y * velocity.x,
  };
  const crossMag = Math.hypot(cross.x, cross.y, cross.z);
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const sinTheta = speed > 0 ? crossMag / speed : 0;
  const liftDir: Vec3 =
    crossMag > 0
      ? { x: cross.x / crossMag, y: cross.y / crossMag, z: cross.z / crossMag }
      : { x: 0, y: 0, z: 0 };
  return { liftDir, sinTheta };
}

function lerp(a: number, b: number, frac: number): number {
  return a + (b - a) * frac;
}

function assertFinite(state: FlightState): void {
  if (
    !Number.isFinite(state.x) ||
    !Number.isFinite(state.y) ||
    !Number.isFinite(state.z) ||
    !Number.isFinite(state.vx) ||
    !Number.isFinite(state.vy) ||
    !Number.isFinite(state.vz) ||
    !Number.isFinite(state.spinRate)
  ) {
    throw new Error(`simulate(): trajectory produced a non-finite value at t=${state.t.toFixed(3)}s`);
  }
}

/**
 * Integrates a point-mass ball flight (drag + Magnus lift + gravity,
 * semi-implicit Euler) from launch to ground contact. Pure function: no
 * randomness, no I/O, SI in and SI out. Rollout is NOT computed here — the
 * caller gets a complete LandingState and owns any surface-aware rollout
 * model (see the M2 shot resolver).
 */
export function simulate(launch: LaunchConditions, options: SimulateOptions = {}): Trajectory {
  const dt = options.dt ?? DEFAULT_DT;
  const maxTime = options.maxTime ?? DEFAULT_MAX_TIME;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const aero = options.aero ?? makeAeroModel(DEFAULT_AERO);

  const { ballSpeed, launchAngle, spinRate, spinAxis, startLine, launchHeight = 0 } = launch;

  const axis = computeSpinAxis(spinAxis, startLine);

  let state: FlightState = {
    x: 0,
    y: launchHeight,
    z: 0,
    vx: ballSpeed * Math.cos(launchAngle) * Math.cos(startLine),
    vy: ballSpeed * Math.sin(launchAngle),
    vz: ballSpeed * Math.cos(launchAngle) * Math.sin(startLine),
    spinRate,
    t: 0,
  };
  assertFinite(state);

  const points: TrajectoryPoint[] = [{ x: state.x, y: state.y, z: state.z, t: state.t }];
  let apex = state.y;
  let prev = state;
  let steps = 0;

  while (state.y >= 0) {
    if (state.t >= maxTime) {
      throw new Error(`simulate(): ball did not land within ${maxTime}s — check launch conditions`);
    }
    if (steps >= maxSteps) {
      throw new Error(`simulate(): exceeded maximum iteration count (${maxSteps}) without landing`);
    }

    prev = state;
    const speed = Math.hypot(prev.vx, prev.vy, prev.vz);
    const spinRatio = speed > 0 ? (prev.spinRate * BALL_RADIUS) / speed : 0;
    const { CL, CD } = aero.coefficients(spinRatio);

    const { liftDir, sinTheta } = magnusKinematics(axis, { x: prev.vx, y: prev.vy, z: prev.vz });

    const dragForce = DRAG_LIFT_CONSTANT * CD * speed;
    const liftForce = DRAG_LIFT_CONSTANT * CL * speed * speed * sinTheta;

    const accX = -dragForce * prev.vx + liftForce * liftDir.x;
    const accY = -dragForce * prev.vy + liftForce * liftDir.y - GRAVITY;
    const accZ = -dragForce * prev.vz + liftForce * liftDir.z;

    const vx = prev.vx + accX * dt;
    const vy = prev.vy + accY * dt;
    const vz = prev.vz + accZ * dt;

    const next: FlightState = {
      vx,
      vy,
      vz,
      x: prev.x + vx * dt,
      y: prev.y + vy * dt,
      z: prev.z + vz * dt,
      spinRate: aero.spinDecay(prev.spinRate, dt),
      t: prev.t + dt,
    };
    assertFinite(next);

    if (next.y > apex) apex = next.y;
    steps += 1;
    state = next;

    if (state.y >= 0) {
      points.push({ x: state.x, y: state.y, z: state.z, t: state.t });
    }
  }

  // `state.y` just went below ground; `prev.y` was still >= 0. Interpolate
  // linearly back to the exact y = 0 crossing rather than reporting an
  // underground final point.
  const frac = prev.y === state.y ? 0 : prev.y / (prev.y - state.y);
  const landingRaw: FlightState = {
    x: lerp(prev.x, state.x, frac),
    y: 0,
    z: lerp(prev.z, state.z, frac),
    vx: lerp(prev.vx, state.vx, frac),
    vy: lerp(prev.vy, state.vy, frac),
    vz: lerp(prev.vz, state.vz, frac),
    spinRate: lerp(prev.spinRate, state.spinRate, frac),
    t: lerp(prev.t, state.t, frac),
  };

  points.push({ x: landingRaw.x, y: 0, z: landingRaw.z, t: landingRaw.t });

  const landingSpeed = Math.hypot(landingRaw.vx, landingRaw.vy, landingRaw.vz);
  const horizontalSpeed = Math.hypot(landingRaw.vx, landingRaw.vz);
  const descentAngle = Math.atan2(-landingRaw.vy, horizontalSpeed);

  const landing: LandingState = {
    position: { x: landingRaw.x, y: 0, z: landingRaw.z },
    velocity: { x: landingRaw.vx, y: landingRaw.vy, z: landingRaw.vz },
    speed: landingSpeed,
    descentAngle,
    spinRate: landingRaw.spinRate,
    spinAxis,
  };

  return {
    points,
    landing,
    apex,
    flightTime: landingRaw.t,
    carry: landingRaw.x,
    lateral: landingRaw.z,
  };
}
