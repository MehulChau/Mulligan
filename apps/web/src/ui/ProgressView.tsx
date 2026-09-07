import type { ShotLog } from "@mulligan/shot-source";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { DispersionPlot } from "../game/DispersionPlot";
import { getAllHoleCompletions, type HoleCompletion } from "../persistence/history";
import { computeAllTimeClubStats, computePersonalBests, computeProgressStats, summarizeRounds } from "../progress/historyStats";
import { distanceUnitLabel, distanceValue, type UnitSystem } from "../preferences";
import { useFocusTrap } from "../useFocusTrap";

export interface ProgressViewProps {
  onClose: () => void;
  shotLog: ShotLog | null;
  courseLength: number;
  unit: UnitSystem;
  onExportEverything: () => void;
  onImportEverythingFile: (e: ChangeEvent<HTMLInputElement>) => void;
}

const TREND_LABEL: Record<NonNullable<ReturnType<typeof computeAllTimeClubStats>[number]["trend"]>, string> = {
  tightening: "tightening ↓",
  widening: "widening ↑",
  steady: "steady",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * "The satisfaction should come from the numbers being real, not from
 * manufactured pressure" -- rounds played / total shots / best round, a
 * history list, personal bests, and all-time per-club stats. No streaks,
 * no badges. Same cardstock full-screen sheet shell as SessionReview and
 * BagEditor.
 */
export function ProgressView({ onClose, shotLog, courseLength, unit, onExportEverything, onImportEverythingFile }: ProgressViewProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const headingRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completions, setCompletions] = useState<HoleCompletion[]>([]);

  useEffect(() => {
    let cancelled = false;
    getAllHoleCompletions()
      .then((c) => {
        if (!cancelled) setCompletions(c);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your history -- try again later.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allEntries = useMemo(() => shotLog?.getAll() ?? [], [shotLog]);
  const rounds = useMemo(() => summarizeRounds(completions, courseLength), [completions, courseLength]);
  const bests = useMemo(() => computePersonalBests(completions, courseLength), [completions, courseLength]);
  const progress = useMemo(() => computeProgressStats(completions, allEntries, courseLength), [completions, allEntries, courseLength]);
  const clubStats = useMemo(() => computeAllTimeClubStats(allEntries), [allEntries]);

  const hasAnyHistory = completions.length > 0;

  return (
    <div className="onboarding-backdrop session-review-backdrop" role="dialog" aria-modal="true" aria-label="Progress">
      <div className="session-review-card" ref={panelRef}>
        <div className="sheet-header">
          <span ref={headingRef} tabIndex={-1}>
            Progress
          </span>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close progress">
            ×
          </button>
        </div>

        {loading ? (
          <div className="readout-empty session-review-empty">Loading…</div>
        ) : error ? (
          <div className="readout-empty session-review-empty">{error}</div>
        ) : !hasAnyHistory ? (
          <div className="readout-empty session-review-empty">
            No holes finished yet -- play one out to start building your history.
          </div>
        ) : (
          <div className="session-review-scroll">
            <div className="sheet-section-label">All time</div>
            <div className="progress-stat-row">
              <div className="progress-stat">
                <div className="progress-stat-value">{progress.roundsPlayed}</div>
                <div className="progress-stat-label">rounds played</div>
              </div>
              <div className="progress-stat">
                <div className="progress-stat-value">{progress.totalShotsAllTime}</div>
                <div className="progress-stat-label">total shots</div>
              </div>
              <div className="progress-stat">
                <div className="progress-stat-value">{progress.bestRoundStrokes ?? "—"}</div>
                <div className="progress-stat-label">best round</div>
              </div>
            </div>

            <div className="sheet-section-label">Personal bests by hole</div>
            <div className="session-shot-list">
              {[...bests.bestByHoleId.entries()].map(([holeId, best]) => (
                <div className="session-shot-row" key={holeId}>
                  <span className="session-shot-desc">
                    {best.holeName} · {best.strokes} ({best.strokes - best.par > 0 ? "+" : ""}
                    {best.strokes - best.par === 0 ? "E" : best.strokes - best.par})
                  </span>
                </div>
              ))}
            </div>

            <div className="sheet-section-label">Per club, all time</div>
            <div className="session-club-list">
              {clubStats.map((c) => (
                <div className="session-club-row" key={c.clubId}>
                  <div className="session-club-info">
                    <div className="session-club-name">{c.clubName}</div>
                    <div className="session-club-stats">
                      {c.count} shot{c.count === 1 ? "" : "s"} · median {distanceValue(c.medianCarryYds, unit)}
                      {distanceUnitLabel(unit)} · ±{distanceValue(c.spreadYds / 2, unit)}
                      {distanceUnitLabel(unit)}
                      {c.trend && ` · ${TREND_LABEL[c.trend]}`}
                    </div>
                  </div>
                  <DispersionPlot points={c.points} />
                </div>
              ))}
            </div>

            <div className="sheet-section-label">History</div>
            <div className="session-shot-list">
              {rounds.map((r) => (
                <div className="session-shot-row" key={r.sessionId}>
                  <span className="session-shot-desc">
                    {formatDate(r.date)} · {r.holesPlayed} hole{r.holesPlayed === 1 ? "" : "s"} · {r.totalStrokes} strokes
                    {r.completedFullCourse ? " · full round" : ""}
                  </span>
                </div>
              ))}
            </div>

            <div className="sheet-section-label">Everything, exported</div>
            <p className="bag-editor-hint">
              Every shot, every hole completion, your bag, and your preferences -- the substitute for an account. Keep
              this somewhere safe; importing it merges into whatever's already on this device/browser.
            </p>
            <div className="progress-export-row">
              <button type="button" className="progress-export-btn" onClick={onExportEverything}>
                Export everything
              </button>
              <label className="progress-export-btn progress-import-label">
                Import everything
                <input type="file" accept="application/json" className="session-file-input" onChange={onImportEverythingFile} />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
