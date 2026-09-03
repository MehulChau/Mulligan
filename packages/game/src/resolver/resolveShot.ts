import {
  degToRad,
  metersToYards,
  mphToMps,
  rpmToRadPerSec,
  simulate,
  type Trajectory,
} from "@mulligan/physics";
import type { ShotEvent } from "@mulligan/shot-source";
import { surfaceAt } from "../surface";
import type { Hole, Point2, SurfaceType } from "../types";
import { localToHole } from "./rotate";
import { estimateRollout } from "./rollout";

export interface ShotResult {
  trajectory: Trajectory; // from physics, in the physics frame
  path2d: Point2[]; // trajectory projected into hole space, for rendering
  landing: Point2; // hole space, yards
  rest: Point2; // hole space, after the M1 rollout placeholder
  landingSurface: SurfaceType;
  restSurface: SurfaceType;
  carryYds: number;
  totalYds: number;
}

/**
 * Turns a physics trajectory into a hole-space result. `shot.startLineDeg`
 * and `shot.spinAxisDeg` are relative to `aimHeadingRad` (the player's
 * chosen aim line, not an absolute heading) -- physics only ever sees the
 * shot's own local frame; this function is the only place that frame gets
 * rotated into hole space.
 */
export function resolveShot(hole: Hole, ballPos: Point2, aimHeadingRad: number, shot: ShotEvent): ShotResult {
  const trajectory = simulate({
    ballSpeed: mphToMps(shot.ballSpeedMph),
    launchAngle: degToRad(shot.launchDeg),
    spinRate: rpmToRadPerSec(shot.spinRpm),
    spinAxis: degToRad(shot.spinAxisDeg),
    startLine: degToRad(shot.startLineDeg),
  });

  const path2d = trajectory.points.map((point) =>
    localToHole(ballPos, aimHeadingRad, { d: metersToYards(point.x), l: metersToYards(point.z) }),
  );

  const carryYds = metersToYards(trajectory.carry);
  const lateralYds = metersToYards(trajectory.lateral);
  const rolloutYds = estimateRollout(trajectory.landing);
  const totalYds = carryYds + rolloutYds; // scalar carry+roll distance, same convention as a launch monitor's "total"

  const landing = localToHole(ballPos, aimHeadingRad, { d: carryYds, l: lateralYds });

  // Roll continues in the direction the ball was actually moving on the
  // ground at landing (its horizontal velocity), not straight along the aim
  // line -- a shot curving right rolls further right, it doesn't snap back
  // onto the aim line just because rollout kicked in.
  const { x: vx, z: vz } = trajectory.landing.velocity;
  const horizontalSpeed = Math.hypot(vx, vz);
  const rollDir = horizontalSpeed > 0 ? { d: vx / horizontalSpeed, l: vz / horizontalSpeed } : { d: 1, l: 0 };
  const rest = localToHole(ballPos, aimHeadingRad, {
    d: carryYds + rolloutYds * rollDir.d,
    l: lateralYds + rolloutYds * rollDir.l,
  });

  return {
    trajectory,
    path2d,
    landing,
    rest,
    landingSurface: surfaceAt(hole, landing),
    restSurface: surfaceAt(hole, rest),
    carryYds,
    totalYds,
  };
}
