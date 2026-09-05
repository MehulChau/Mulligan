import type { ClubId } from "../clubs";

export interface Measurement {
  clubId: ClubId;
  ballSpeedMph: number;
  launchDeg: number;
  /** If the launch monitor reported it — otherwise the club profile's spin is used. */
  spinRpm?: number;
  carryYds: number;
  apexFt?: number;
  descentDeg?: number;
  /** e.g. 'trackman-2026-09-14', 'gcquad', 'estimated' */
  source: string;
}

// Starts empty. Fill this in against real range data, then run
// `npm run calibrate` to fit the aero model to it. See docs/range-session.md
// for the phone-sized checklist of what to bring back from the range.
//
// One filled-in row looks like this (fictional numbers, driver):
//
// {
//   clubId: "driver",
//   ballSpeedMph: 152,
//   launchDeg: 11.2,
//   spinRpm: 2450, // omit this line entirely if your monitor didn't report spin
//   carryYds: 231,
//   apexFt: 98,
//   descentDeg: 38,
//   source: "range-session-2026-09-14",
// },
export const MEASUREMENTS: Measurement[] = [];

/** A min/median/max summary of a group of carries — faster to jot down mid-bucket than every individual shot. */
export interface CarrySummary {
  minYds: number;
  medianYds: number;
  maxYds: number;
}

export interface DispersionMeasurement {
  clubId: ClubId;
  /**
   * How hard the group was swung, 0.3-1.0 — matches
   * `@mulligan/shot-source`'s `swingFraction` range directly, so a wedge
   * bucket hit at, say, half swing can be used to tune
   * `scaleDispersionForSwing`'s `partialSwingPenalty` against something
   * real instead of a guess. Omit for a full-swing bucket.
   */
  swingFraction?: number;
  shotCount: number;
  /** Either every individual carry (yards) or just a min/median/max summary — whichever is faster to write down at the range. */
  carryYds: number[] | CarrySummary;
  /** Total left-right spread, yards, edge to edge across the group. */
  lateralSpreadYds: number;
  /** e.g. 'trackman-2026-09-14', 'gcquad', 'estimated' */
  source: string;
}

// Starts empty. This is the spread half of calibration -- MEASUREMENTS
// above is "how far does one good shot go," this is "how much does a
// group of shots scatter." Wedge buckets at more than one swing fraction
// are what `partialSwingPenalty` (see swing.ts) actually needs to stop
// being a guess. See docs/range-session.md for the wedge-spread step.
//
// One filled-in row looks like this (fictional numbers, a half-swing
// lob wedge bucket):
//
// {
//   clubId: "lw",
//   swingFraction: 0.5,
//   shotCount: 10,
//   carryYds: { minYds: 18, medianYds: 22, maxYds: 27 },
//   lateralSpreadYds: 6,
//   source: "range-session-2026-09-14",
// },
export const DISPERSION_MEASUREMENTS: DispersionMeasurement[] = [];
