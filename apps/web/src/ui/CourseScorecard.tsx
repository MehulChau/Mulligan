import type { Hole } from "@mulligan/game";
import { useEffect, useRef } from "react";

export interface CourseScorecardProps {
  course: readonly Hole[];
  roundScores: Partial<Record<string, number>>;
  onNewRound: () => void;
  onHoleSelect: () => void;
}

function toParText(strokes: number, par: number): string {
  const diff = strokes - par;
  if (diff === 0) return "E";
  return diff > 0 ? `+${diff}` : `${diff}`;
}

/**
 * The full-round card, shown once the last hole in the course is holed
 * out -- same cardstock identity as the per-hole ScorecardSummary, scaled
 * up to a real scorecard's actual job: every hole, par, score, and the
 * total. Holes played out of sequence (via hole-select) still show their
 * most recent score; a hole never played shows a dash, not a zero.
 */
export function CourseScorecard({ course, roundScores, onNewRound, onHoleSelect }: CourseScorecardProps) {
  const playedPars = course.filter((h) => roundScores[h.id] !== undefined);
  const totalPar = playedPars.reduce((sum, h) => sum + h.par, 0);
  const totalStrokes = playedPars.reduce((sum, h) => sum + (roundScores[h.id] ?? 0), 0);
  const allPlayed = playedPars.length === course.length;

  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  return (
    <div className="scorecard">
      <div className="scorecard-perforation" aria-hidden="true" />
      <div className="scorecard-body">
        <div
          className="scorecard-hole"
          ref={summaryRef}
          tabIndex={-1}
          aria-label={`${allPlayed ? "Round complete" : "Round so far"}. ${playedPars.length} of ${course.length} holes played${playedPars.length > 0 ? `, ${totalStrokes} strokes` : ""}.`}
        >
          {allPlayed ? "Round complete" : "Round so far"}
        </div>

        <div className="course-scorecard-rows">
          {course.map((hole, i) => {
            const score = roundScores[hole.id];
            return (
              <div className="course-scorecard-row" key={hole.id}>
                <span className="course-scorecard-num">{i + 1}</span>
                <span className="course-scorecard-name">{hole.name}</span>
                <span className="course-scorecard-par">Par {hole.par}</span>
                <span className="course-scorecard-strokes">{score ?? "—"}</span>
                <span className="course-scorecard-topar">{score !== undefined ? toParText(score, hole.par) : ""}</span>
              </div>
            );
          })}
        </div>

        <div className="scorecard-score">
          <span className="scorecard-total">{playedPars.length > 0 ? totalStrokes : "—"}</span>
          {playedPars.length > 0 && <span className="scorecard-topar">{toParText(totalStrokes, totalPar)}</span>}
        </div>
        <div className="scorecard-breakdown">
          {playedPars.length} of {course.length} holes played{playedPars.length > 0 ? ` · ${totalPar} par so far` : ""}
        </div>

        <button type="button" className="hit" onClick={onNewRound}>
          New round
        </button>
        <button type="button" className="device-action device-action-quiet course-scorecard-holes-btn" onClick={onHoleSelect}>
          Choose a hole
        </button>
      </div>
    </div>
  );
}
