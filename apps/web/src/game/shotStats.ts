import { degToRad, metersToYards, mphToMps, rpmToRadPerSec, simulate } from "@mulligan/physics";
import { findClub, type ShotLogEntry } from "@mulligan/shot-source";
import type { DispersionPoint } from "./DispersionPlot";

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Re-simulates a ball-flight entry's own raw+shot fields to get carry/
 * lateral relative to the aim line -- the log stores hole-space rest
 * position, not this, but startLineDeg/spinAxisDeg are already
 * aim-relative, so the physics module reproduces it exactly. Shared by
 * SessionReview (one session) and the all-time per-club stats (every
 * session) -- same math, different slice of the log.
 */
export function carryAndLateral(shot: NonNullable<ShotLogEntry["shot"]>): { carryYds: number; lateralYds: number } {
  const trajectory = simulate({
    ballSpeed: mphToMps(shot.ballSpeedMph),
    launchAngle: degToRad(shot.launchDeg),
    spinRate: rpmToRadPerSec(shot.spinRpm),
    spinAxis: degToRad(shot.spinAxisDeg),
    startLine: degToRad(shot.startLineDeg),
  });
  return { carryYds: metersToYards(trajectory.carry), lateralYds: metersToYards(trajectory.lateral) };
}

export interface ClubSummary {
  clubId: string;
  clubName: string;
  count: number;
  medianCarryYds: number;
  spreadYds: number; // max - min carry, yards -- the simplest honest dispersion number
  points: DispersionPoint[];
}

export function summarizeByClub(ballFlightEntries: { entry: ShotLogEntry; carryYds: number; lateralYds: number }[]): ClubSummary[] {
  const byClub = new Map<string, { carries: number[]; points: DispersionPoint[] }>();

  for (const { entry, carryYds, lateralYds } of ballFlightEntries) {
    const clubId = entry.shot!.clubId;
    const bucket = byClub.get(clubId) ?? { carries: [], points: [] };
    bucket.carries.push(carryYds);
    bucket.points.push({ carryYds, lateralYds });
    byClub.set(clubId, bucket);
  }

  const out: ClubSummary[] = [];
  for (const [clubId, { carries, points }] of byClub) {
    out.push({
      clubId,
      clubName: findClub(clubId as Parameters<typeof findClub>[0]).name,
      count: carries.length,
      medianCarryYds: median(carries),
      spreadYds: Math.max(...carries) - Math.min(...carries),
      points,
    });
  }
  // Longest club first -- matches the bag order everywhere else in the app.
  out.sort((a, b) => b.medianCarryYds - a.medianCarryYds);
  return out;
}

export function ballFlightEntriesOf(entries: ShotLogEntry[]): { entry: ShotLogEntry; carryYds: number; lateralYds: number }[] {
  return entries.filter((entry) => !entry.isPutt && entry.shot).map((entry) => ({ entry, ...carryAndLateral(entry.shot!) }));
}
