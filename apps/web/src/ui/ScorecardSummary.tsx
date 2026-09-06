import type { Hole, Point2, ScoreBreakdown } from "@mulligan/game";
import { useEffect, useRef } from "react";
import { MiniHoleTrace } from "../game/MiniHoleTrace";

export interface ScorecardSummaryProps {
  hole: Hole;
  breakdown: ScoreBreakdown;
  paths: Point2[][];
  restSpots: Point2[];
  /** "Next hole" mid-round, "Replay hole" from hole-select practice -- App.tsx decides which this hole needs. */
  continueLabel: string;
  onContinue: () => void;
}

function scoreToParText(strokes: number, par: number): string {
  const diff = strokes - par;
  if (diff === 0) return "E";
  return diff > 0 ? `+${diff}` : `${diff}`;
}

/**
 * Scorecard-styled, not a modal -- leans into the turf/scorecard identity
 * instead of interrupting it. The mini trace is the same "how you got here"
 * idea as the ghost traces on the live hole, just for the whole round at
 * once.
 */
export function ScorecardSummary({ hole, breakdown, paths, restSpots, continueLabel, onContinue }: ScorecardSummaryProps) {
  const topar = scoreToParText(breakdown.totalStrokes, breakdown.par);
  // breakdown.label is only a distinct word ("birdie", "double bogey", ...)
  // inside the named range around par -- outside it, scoreToParLabel falls
  // back to the same "+N" this card already shows next to the total, so
  // showing both would just repeat the number.
  const hasNamedLabel = !/^[+-]?\d+$/.test(breakdown.label);

  // Focus management: a keyboard/screen-reader user needs to hear that the
  // hole just finished without hunting for it -- move focus to a summary
  // of the result the instant this card appears, same moment a sighted
  // player's eye is drawn to the score.
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
          aria-label={`${hole.name}, ${breakdown.totalStrokes} strokes, ${breakdown.label}`}
        >
          {hole.name}
        </div>
        <div className="scorecard-score">
          <span className="scorecard-total">{breakdown.totalStrokes}</span>
          <span className="scorecard-topar">{topar}</span>
        </div>
        {hasNamedLabel && <div className="scorecard-label">{breakdown.label}</div>}
        <MiniHoleTrace hole={hole} paths={paths} restSpots={restSpots} />
        <div className="scorecard-breakdown">
          {breakdown.strokesToGreen} to the green · {breakdown.putts} putt{breakdown.putts === 1 ? "" : "s"} · par {breakdown.par}
        </div>
        <button type="button" className="hit" onClick={onContinue}>
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
