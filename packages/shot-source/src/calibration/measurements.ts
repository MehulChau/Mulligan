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
// `npm run calibrate` to fit the aero model to it.
export const MEASUREMENTS: Measurement[] = [];
