import type { ScoreBreakdown } from "@mulligan/game";

export interface HoleCompleteSummaryProps {
  breakdown: ScoreBreakdown;
  onPlayAgain: () => void;
}

export function HoleCompleteSummary({ breakdown, onPlayAgain }: HoleCompleteSummaryProps) {
  return (
    <div className="hud">
      <div className="hud-headline">
        {breakdown.totalStrokes} ({breakdown.label})
      </div>
      <div className="score-breakdown">
        {breakdown.strokesToGreen} to the green, {breakdown.putts} putt{breakdown.putts === 1 ? "" : "s"} · par {breakdown.par}
      </div>
      <div className="play-again-row">
        <button type="button" className="hit" onClick={onPlayAgain}>
          Play again
        </button>
      </div>
    </div>
  );
}
