import type { PuttResult } from "@mulligan/game";
import { formatShortDistance, type UnitSystem } from "../preferences";

export interface PuttingPanelProps {
  puttDistanceYds: number;
  puttAttempts: number;
  lastPuttResult: PuttResult | null;
  disabled: boolean;
  onPutt: () => void;
  unit: UnitSystem;
}

export function PuttingPanel({ puttDistanceYds, puttAttempts, lastPuttResult, disabled, onPutt, unit }: PuttingPanelProps) {
  return (
    <div className="controls putting-panel">
      <div className="putting-distance">
        <b>{formatShortDistance(puttDistanceYds, unit)}</b>
        <span>to the hole{puttAttempts > 0 ? ` · putt ${puttAttempts + 1}` : ""}</span>
      </div>

      {lastPuttResult && !lastPuttResult.holed && (
        <div className="putting-feedback">Missed — {formatShortDistance(lastPuttResult.distanceAfter, unit)} left</div>
      )}

      <div className="hitrow">
        <button type="button" className="hit" disabled={disabled} onClick={onPutt}>
          Putt
        </button>
      </div>
    </div>
  );
}
