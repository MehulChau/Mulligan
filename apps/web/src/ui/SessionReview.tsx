import { degToRad, metersToYards, mphToMps, rpmToRadPerSec, simulate } from "@mulligan/physics";
import { findClub, type ShotLogEntry } from "@mulligan/shot-source";
import { useEffect, useMemo, useRef } from "react";
import { DispersionPlot, type DispersionPoint } from "../game/DispersionPlot";
import { useFocusTrap } from "../useFocusTrap";

export interface SessionReviewProps {
  entries: ShotLogEntry[];
  onClose: () => void;
  onExport: () => void;
}

interface ClubSummary {
  clubId: string;
  clubName: string;
  count: number;
  medianCarryYds: number;
  spreadYds: number; // max - min carry, yards -- the simplest honest dispersion number
  points: DispersionPoint[];
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Re-simulates a ball-flight entry's own raw+shot fields to get carry/lateral relative to the aim line -- the log stores hole-space rest position, not this, but startLineDeg/spinAxisDeg are already aim-relative, so the physics module reproduces it exactly. */
function carryAndLateral(shot: NonNullable<ShotLogEntry["shot"]>): { carryYds: number; lateralYds: number } {
  const trajectory = simulate({
    ballSpeed: mphToMps(shot.ballSpeedMph),
    launchAngle: degToRad(shot.launchDeg),
    spinRate: rpmToRadPerSec(shot.spinRpm),
    spinAxis: degToRad(shot.spinAxisDeg),
    startLine: degToRad(shot.startLineDeg),
  });
  return { carryYds: metersToYards(trajectory.carry), lateralYds: metersToYards(trajectory.lateral) };
}

function summarizeByClub(ballFlightEntries: { entry: ShotLogEntry; carryYds: number; lateralYds: number }[]): ClubSummary[] {
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

/**
 * The shot log has been recorded since M1 and never shown to anyone.
 * Full-screen (same shell as Onboarding, cardstock-styled body to stay
 * consistent with the scorecard identity rather than inventing a second
 * visual language): per-club summary with a dispersion plot, then every
 * shot in order with its provenance.
 */
export function SessionReview({ entries, onClose, onExport }: SessionReviewProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  const ballFlightEntries = useMemo(
    () =>
      entries
        .filter((entry) => !entry.isPutt && entry.shot)
        .map((entry) => ({ entry, ...carryAndLateral(entry.shot!) })),
    [entries],
  );
  const clubSummaries = useMemo(() => summarizeByClub(ballFlightEntries), [ballFlightEntries]);
  const carryByTimestamp = useMemo(() => {
    const map = new Map<number, number>();
    for (const { entry, carryYds } of ballFlightEntries) map.set(entry.timestamp, carryYds);
    return map;
  }, [ballFlightEntries]);

  const shotCount = ballFlightEntries.length;
  const puttCount = entries.length - shotCount;

  return (
    <div className="onboarding-backdrop session-review-backdrop" role="dialog" aria-modal="true" aria-label="Session review">
      <div className="session-review-card" ref={panelRef}>
        <div className="sheet-header">
          <span ref={summaryRef} tabIndex={-1} aria-label={`Session review. ${shotCount} shots, ${puttCount} putts.`}>
            Session
          </span>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close session review">
            ×
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="readout-empty session-review-empty">No shots yet this session -- play a hole to see it here.</div>
        ) : (
          <div className="session-review-scroll">
            <div className="sheet-section-label">Per club</div>
            <div className="session-club-list">
              {clubSummaries.map((c) => (
                <div className="session-club-row" key={c.clubId}>
                  <div className="session-club-info">
                    <div className="session-club-name">{c.clubName}</div>
                    <div className="session-club-stats">
                      {c.count} shot{c.count === 1 ? "" : "s"} · median {Math.round(c.medianCarryYds)}yd · ±{Math.round(c.spreadYds / 2)}yd
                    </div>
                  </div>
                  <DispersionPlot points={c.points} />
                </div>
              ))}
            </div>

            <div className="sheet-section-label">Every shot</div>
            <div className="session-shot-list">
              {entries.map((entry, i) => (
                <div className="session-shot-row" key={`${entry.timestamp}-${i}`}>
                  <span className="session-shot-num">{entry.strokeNumber}</span>
                  {entry.isPutt ? (
                    <span className="session-shot-desc">
                      Putt · {Math.round(entry.puttDistanceBeforeYds! * 3)}ft · {entry.holed ? "holed" : "missed"}
                    </span>
                  ) : (
                    <span className="session-shot-desc">
                      {findClub(entry.shot!.clubId).name} · {Math.round(carryByTimestamp.get(entry.timestamp) ?? 0)}yd
                      <span className={"prov " + entry.shot!.provenance.ballSpeed}>{Math.round(entry.shot!.ballSpeedMph)}mph</span>
                      <span className={"prov " + entry.shot!.provenance.launch}>{entry.shot!.launchDeg.toFixed(1)}°</span>
                    </span>
                  )}
                </div>
              ))}
            </div>

            <button type="button" className="device-action device-action-quiet session-review-export" onClick={onExport}>
              Export this session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
