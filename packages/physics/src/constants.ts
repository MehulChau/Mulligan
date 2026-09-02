/**
 * Named physical constants — single source of truth for the ball-flight model.
 * Everything in this file (and the rest of physics/**) is SI. Unit conversions
 * for mph/yards/feet/degrees/rpm happen only at the functions below — nothing
 * downstream of the module boundary should see a bare conversion literal.
 */

export const GRAVITY = 9.81; // m/s^2
export const AIR_DENSITY = 1.225; // kg/m^3, sea level standard
export const BALL_MASS = 0.04593; // kg
export const BALL_DIAMETER = 0.04267; // m
export const BALL_RADIUS = BALL_DIAMETER / 2; // m
export const BALL_CROSS_SECTIONAL_AREA = (Math.PI * BALL_DIAMETER * BALL_DIAMETER) / 4; // m^2

/** rho * A / (2m) — the constant factor shared by the drag and lift force terms. */
export const DRAG_LIFT_CONSTANT = (AIR_DENSITY * BALL_CROSS_SECTIONAL_AREA) / (2 * BALL_MASS);

// Exact SI definitions (1 mile = 1609.344 m, 1 yard/foot = 0.9144/0.3048 m) —
// more precise than the prototype's rounded 0.44704/1.09361/3.28084 literals,
// well within golden-table tolerance.
const MPS_PER_MPH = 1609.344 / 3600;
const METERS_PER_YARD = 0.9144;
const METERS_PER_FOOT = 0.3048;
const RAD_PER_DEG = Math.PI / 180;
const RAD_PER_SEC_PER_RPM = (2 * Math.PI) / 60;

export function mphToMps(mph: number): number {
  return mph * MPS_PER_MPH;
}

export function mpsToMph(mps: number): number {
  return mps / MPS_PER_MPH;
}

export function metersToYards(meters: number): number {
  return meters / METERS_PER_YARD;
}

export function yardsToMeters(yards: number): number {
  return yards * METERS_PER_YARD;
}

export function metersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}

export function feetToMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

export function degToRad(deg: number): number {
  return deg * RAD_PER_DEG;
}

export function radToDeg(rad: number): number {
  return rad / RAD_PER_DEG;
}

export function rpmToRadPerSec(rpm: number): number {
  return rpm * RAD_PER_SEC_PER_RPM;
}

export function radPerSecToRpm(radPerSec: number): number {
  return radPerSec / RAD_PER_SEC_PER_RPM;
}
