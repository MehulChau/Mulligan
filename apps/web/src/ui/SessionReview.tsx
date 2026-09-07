import { findClub, type ShotLogEntry } from "@mulligan/shot-source";
import { useEffect, useMemo, useRef } from "react";
import { DispersionPlot } from "../game/DispersionPlot";
import { ballFlightEntriesOf, summarizeByClub } from "../game/shotStats";
import { distanceValue, distanceUnitLabel, formatShortDistance, type UnitSystem } from "../preferences";
import { useFocusTrap } from "../useFocusTrap";

export interface SessionReviewProps {
  entries: ShotLogEntry[];
  onClose: () => void;
  onExport: () => void;
  unit: UnitSystem;
}

/**
 * The shot log has been recorded since M1 and never shown to anyone.
 * Full-screen (same shell as Onboarding, cardstock-styled body to stay
 * consistent with the scorecard identity rather than inventing a second
 * visual language): per-club summary with a dispersion plot, then every
 * shot in order with its provenance.
 */
export function SessionReview({ entries, onClose, onExport, unit }: SessionReviewProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  const ballFlightEntries = useMemo(() => ballFlightEntriesOf(entries), [entries]);
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
                      {c.count} shot{c.count === 1 ? "" : "s"} · median {distanceValue(c.medianCarryYds, unit)}
                      {distanceUnitLabel(unit)} · ±{distanceValue(c.spreadYds / 2, unit)}
                      {distanceUnitLabel(unit)}
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
                      Putt · {formatShortDistance(entry.puttDistanceBeforeYds!, unit)} · {entry.holed ? "holed" : "missed"}
                    </span>
                  ) : (
                    <span className="session-shot-desc">
                      {findClub(entry.shot!.clubId).name} · {distanceValue(carryByTimestamp.get(entry.timestamp) ?? 0, unit)}
                      {distanceUnitLabel(unit)}
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
