import type { PenaltyKind, SurfaceType } from "@mulligan/game";
import { SURFACE_LABEL } from "../game/surfaceLabels";

const PENALTY_MESSAGE: Record<PenaltyKind, string> = {
  water: "In the water — +1, dropping nearby",
  out: "Out of bounds — +1 and replay from your last spot",
};

export interface DistanceHeroProps {
  distanceToPinYds: number;
  surface: SurfaceType;
  lastPenalty: PenaltyKind | null;
}

/**
 * The number the player actually looks at, per range-session rhythm: glance
 * at distance, pick a club, swing. Everything else here is secondary text
 * beneath it, not competing for size.
 */
export function DistanceHero({ distanceToPinYds, surface, lastPenalty }: DistanceHeroProps) {
  return (
    <div className="distance-hero">
      <div className="distance-value">{Math.round(distanceToPinYds)}</div>
      <div className="distance-sub">
        yds to pin · <span className="distance-lie">{SURFACE_LABEL[surface]}</span>
      </div>
      {lastPenalty && <div className="penalty-callout">{PENALTY_MESSAGE[lastPenalty]}</div>}
    </div>
  );
}
