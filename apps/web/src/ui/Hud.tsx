import type { PenaltyKind, SurfaceType } from "@mulligan/game";
import type { ClubProfile, Provenance, ShotField } from "@mulligan/shot-source";

const SURFACE_LABEL: Record<SurfaceType, string> = {
  tee: "Tee",
  fairway: "Fairway",
  rough: "Rough",
  green: "Green",
  bunker: "Bunker",
  water: "Water",
  out: "Out of bounds",
};

const PENALTY_MESSAGE: Record<PenaltyKind, string> = {
  water: "In the water — +1, dropping nearby",
  out: "Out of bounds — +1 and replay from your last spot",
};

export interface LastShotSummary {
  carryYds: number;
  totalYds: number;
  provenance: Record<ShotField, Provenance>;
}

export interface HudProps {
  distanceToPinYds: number;
  surface: SurfaceType;
  strokeCount: number;
  par: number;
  selectedClub: ClubProfile;
  expectedCarryYds: number;
  lastShot: LastShotSummary | null;
  lastPenalty: PenaltyKind | null;
}

const FIELD_LABEL: Record<ShotField, string> = {
  ballSpeed: "Ball speed",
  launch: "Launch",
  spin: "Spin",
  spinAxis: "Spin axis",
  startLine: "Start line",
};

export function Hud({ distanceToPinYds, surface, strokeCount, par, selectedClub, expectedCarryYds, lastShot, lastPenalty }: HudProps) {
  return (
    <div className="hud">
      <div className="hud-row hud-primary">
        <div className="hud-stat">
          <b>{Math.round(distanceToPinYds)}</b>
          <span>yds to pin</span>
        </div>
        <div className="hud-stat">
          <b>{SURFACE_LABEL[surface]}</b>
          <span>lie</span>
        </div>
        <div className="hud-stat">
          <b>
            {strokeCount + 1}
            <span className="hud-par"> / par {par}</span>
          </b>
          <span>shot</span>
        </div>
        <div className="hud-stat">
          <b>{selectedClub.name}</b>
          <span>~{Math.round(expectedCarryYds)} yds</span>
        </div>
      </div>

      {lastPenalty && <div className="penalty-callout">{PENALTY_MESSAGE[lastPenalty]}</div>}

      {lastShot && (
        <div className="hud-row hud-lastshot">
          <span>
            Last: <b>{Math.round(lastShot.carryYds)}</b> carry / <b>{Math.round(lastShot.totalYds)}</b> total
          </span>
          <span className="provenance">
            {(Object.keys(lastShot.provenance) as ShotField[]).map((field) => (
              <span key={field} className={"prov " + lastShot.provenance[field]} title={FIELD_LABEL[field]}>
                {FIELD_LABEL[field]}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
