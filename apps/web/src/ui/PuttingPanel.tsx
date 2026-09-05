import type { PuttResult } from "@mulligan/game";

export interface PuttingPanelProps {
  puttDistanceYds: number;
  puttAttempts: number;
  lastPuttResult: PuttResult | null;
  disabled: boolean;
  onPutt: () => void;
}

function formatDistance(yds: number): string {
  const feet = yds * 3;
  if (feet < 1) return "a tap-in";
  return `${feet.toFixed(feet < 10 ? 1 : 0)} ft`;
}

export function PuttingPanel({ puttDistanceYds, puttAttempts, lastPuttResult, disabled, onPutt }: PuttingPanelProps) {
  return (
    <div className="controls putting-panel">
      <div className="putting-distance">
        <b>{formatDistance(puttDistanceYds)}</b>
        <span>to the hole{puttAttempts > 0 ? ` · putt ${puttAttempts + 1}` : ""}</span>
      </div>

      {lastPuttResult && !lastPuttResult.holed && (
        <div className="putting-feedback">Missed — {formatDistance(lastPuttResult.distanceAfter)} left</div>
      )}

      <div className="hitrow">
        <button type="button" className="hit" disabled={disabled} onClick={onPutt}>
          Putt
        </button>
      </div>
    </div>
  );
}
