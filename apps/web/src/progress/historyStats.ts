import type { ShotLogEntry } from "@mulligan/shot-source";
import type { HoleCompletion } from "../persistence/history";
import { ballFlightEntriesOf, summarizeByClub, type ClubSummary } from "../game/shotStats";

export interface RoundSummary {
  sessionId: string;
  /** Timestamp of the first hole completed in this session. */
  date: number;
  holesPlayed: number;
  totalStrokes: number;
  /** Every distinct hole in COURSE was played in this session, at least once. */
  completedFullCourse: boolean;
}

/** Groups hole completions by session -- a "round" is derived, not stored, so nothing needs finalizing when a session ends or is abandoned mid-course. Most recent first. */
export function summarizeRounds(completions: HoleCompletion[], courseLength: number): RoundSummary[] {
  const bySession = new Map<string, HoleCompletion[]>();
  for (const c of completions) {
    const list = bySession.get(c.sessionId) ?? [];
    list.push(c);
    bySession.set(c.sessionId, list);
  }

  const rounds: RoundSummary[] = [];
  for (const [sessionId, holes] of bySession) {
    const distinctHoles = new Set(holes.map((h) => h.courseHoleIndex));
    rounds.push({
      sessionId,
      date: Math.min(...holes.map((h) => h.timestamp)),
      holesPlayed: holes.length,
      totalStrokes: holes.reduce((sum, h) => sum + h.strokes, 0),
      completedFullCourse: distinctHoles.size >= courseLength,
    });
  }
  rounds.sort((a, b) => b.date - a.date);
  return rounds;
}

export interface PersonalBests {
  /** Lowest strokes ever recorded for each hole, keyed by hole id. */
  bestByHoleId: Map<string, { strokes: number; par: number; holeName: string; date: number }>;
  /** Lowest full-course total across sessions that played every hole at least once. */
  bestFullCourseTotal: { strokes: number; date: number } | null;
}

export function computePersonalBests(completions: HoleCompletion[], courseLength: number): PersonalBests {
  const bestByHoleId = new Map<string, { strokes: number; par: number; holeName: string; date: number }>();
  for (const c of completions) {
    const current = bestByHoleId.get(c.holeId);
    if (!current || c.strokes < current.strokes) {
      bestByHoleId.set(c.holeId, { strokes: c.strokes, par: c.par, holeName: c.holeName, date: c.timestamp });
    }
  }

  const rounds = summarizeRounds(completions, courseLength).filter((r) => r.completedFullCourse);
  let bestFullCourseTotal: PersonalBests["bestFullCourseTotal"] = null;
  for (const r of rounds) {
    if (!bestFullCourseTotal || r.totalStrokes < bestFullCourseTotal.strokes) {
      bestFullCourseTotal = { strokes: r.totalStrokes, date: r.date };
    }
  }

  return { bestByHoleId, bestFullCourseTotal };
}

export interface ProgressStats {
  /** Distinct sessions with at least one completed hole -- practice sessions count, not just full 6-hole rounds. */
  roundsPlayed: number;
  /** Every stroke ever logged (ball-flight + putts), across every session. */
  totalShotsAllTime: number;
  bestRoundStrokes: number | null;
}

export function computeProgressStats(completions: HoleCompletion[], allShotLogEntries: ShotLogEntry[], courseLength: number): ProgressStats {
  const sessions = new Set(completions.map((c) => c.sessionId));
  const bests = computePersonalBests(completions, courseLength);
  return {
    roundsPlayed: sessions.size,
    totalShotsAllTime: allShotLogEntries.length,
    bestRoundStrokes: bests.bestFullCourseTotal?.strokes ?? null,
  };
}

export interface ClubStatWithTrend extends ClubSummary {
  /**
   * Compares the spread (dispersion) of the more recent half of this
   * club's shots against the earlier half -- "tightening" if the recent
   * half's spread is meaningfully smaller, "widening" if meaningfully
   * larger, "steady" otherwise. Needs at least 6 shots total (3 per half)
   * before it says anything at all; fewer than that is noise, not a trend.
   */
  trend: "tightening" | "widening" | "steady" | null;
}

const MIN_SHOTS_FOR_TREND = 6;
/** How much smaller/larger the recent half's spread has to be before calling it a trend rather than noise. */
const TREND_THRESHOLD_FRACTION = 0.15;

function spreadOf(carries: number[]): number {
  return Math.max(...carries) - Math.min(...carries);
}

/** All-time per-club stats across every session ever logged -- same shape SessionReview uses for one session, plus a trend. */
export function computeAllTimeClubStats(allEntries: ShotLogEntry[]): ClubStatWithTrend[] {
  const ballFlight = ballFlightEntriesOf(allEntries).sort((a, b) => a.entry.timestamp - b.entry.timestamp);
  const summaries = summarizeByClub(ballFlight);

  const byClub = new Map<string, number[]>();
  for (const { entry, carryYds } of ballFlight) {
    const list = byClub.get(entry.shot!.clubId) ?? [];
    list.push(carryYds);
    byClub.set(entry.shot!.clubId, list);
  }

  return summaries.map((summary) => {
    const carries = byClub.get(summary.clubId) ?? [];
    let trend: ClubStatWithTrend["trend"] = null;
    if (carries.length >= MIN_SHOTS_FOR_TREND) {
      const mid = Math.floor(carries.length / 2);
      const earlySpread = spreadOf(carries.slice(0, mid));
      const recentSpread = spreadOf(carries.slice(mid));
      const change = earlySpread === 0 ? 0 : (recentSpread - earlySpread) / earlySpread;
      if (change <= -TREND_THRESHOLD_FRACTION) trend = "tightening";
      else if (change >= TREND_THRESHOLD_FRACTION) trend = "widening";
      else trend = "steady";
    }
    return { ...summary, trend };
  });
}
