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

// Real range data goes here too, alongside the published data below, once
// Mehul's own range session happens (see docs/range-session.md). New rows
// must follow the same rule as the ones already here: carry, apex, and
// descent angle must come from the same shot or the same published row --
// never mixed across sources.
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
//
// The eight rows below are Trackman's own published "PGA Tour Averages"
// figures (yards), sourced from a Trackman-branded infographic mirrored at
// https://teeituprva.com/wp-content/uploads/2019/03/PGA-AVERAGES-INTERACTIVE.pdf
// (file path suggests a ~2019 vintage; Trackman has since published a 2024
// tour-averages revision -- https://www.trackman.com/blog/introducing-updated-tour-averages
// -- that may show updated numbers, but that page renders its table as an
// image rather than text, so it could not be transcribed for this file).
// Cross-checked: an independent web search snippet, retrieved separately
// from this PDF, quoted identical Driver/3-wood/5-wood/PW figures.
//
// Carry, Max Height (apex), and Land Angle (descent) all come from the
// same published row per club, exactly as the sourcing rule above
// requires -- this is real PGA Tour averaged shot data, not a mix of
// carry from one place and descent from another.
//
// Deliberately stops at PW: Trackman's public tour-averages table does not
// publish gap/sand/lob wedge as full-swing bag-average entries (unlike the
// irons and woods, tour wedge shots are overwhelmingly partial/finesse
// shots, not full swings, so there's no "tour average full swing" bucket
// for them to report) -- searched specifically and came up empty, so gw/sw/lw
// stay unsourced here rather than filled in from a different, incompatible
// kind of data. 5-hybrid also stays out: the table's one hybrid row is
// labeled "15-18°" of loft, which is a 2-3 hybrid, not a 5-hybrid, and
// mapping it to our 5h preset would be exactly the kind of unjustified
// substitution the sourcing rule exists to prevent. Since DEFAULT_AERO is
// a universal ball-flight model, not a per-club one, calibrating it well
// against these eight clubs (spanning nearly the full spin range, 2686-
// 9304rpm) still improves the physics for every club, including the four
// left out here.
export const MEASUREMENTS: Measurement[] = [
  {
    clubId: "driver",
    ballSpeedMph: 167,
    launchDeg: 10.9,
    spinRpm: 2686,
    carryYds: 275,
    apexFt: 96,
    descentDeg: 38,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
  {
    clubId: "3w",
    ballSpeedMph: 158,
    launchDeg: 9.2,
    spinRpm: 3655,
    carryYds: 243,
    apexFt: 90,
    descentDeg: 43,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
  {
    clubId: "5w",
    ballSpeedMph: 152,
    launchDeg: 9.4,
    spinRpm: 4350,
    carryYds: 230,
    apexFt: 93,
    descentDeg: 47,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
  {
    clubId: "6i",
    ballSpeedMph: 127,
    launchDeg: 14.1,
    spinRpm: 6231,
    carryYds: 183,
    apexFt: 90,
    descentDeg: 50,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
  {
    clubId: "7i",
    ballSpeedMph: 120,
    launchDeg: 16.3,
    spinRpm: 7097,
    carryYds: 172,
    apexFt: 96,
    descentDeg: 50,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
  {
    clubId: "8i",
    ballSpeedMph: 115,
    launchDeg: 18.1,
    spinRpm: 7998,
    carryYds: 160,
    apexFt: 93,
    descentDeg: 50,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
  {
    clubId: "9i",
    ballSpeedMph: 109,
    launchDeg: 20.4,
    spinRpm: 8647,
    carryYds: 148,
    apexFt: 90,
    descentDeg: 51,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
  {
    clubId: "pw",
    ballSpeedMph: 102,
    launchDeg: 24.2,
    spinRpm: 9304,
    carryYds: 136,
    apexFt: 87,
    descentDeg: 52,
    source: "trackman-pga-tour-averages-2019-teeituprva-pdf",
  },
];

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
