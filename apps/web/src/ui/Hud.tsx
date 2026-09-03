import type { SurfaceType } from "@mulligan/game";
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

export interface LastShotSummary {
  carryYds: number;
  totalYds: number;
  provenance: Record<ShotField, Provenance>;
}

export interface HudProps {
  distanceToPinYds: number;
  surface: SurfaceType;
  shotNumber: number;
  selectedClub: ClubProfile;
  expectedCarryYds: number;
  lastShot: LastShotSummary | null;
  onGreenInShots: number | null;
}

const FIELD_LABEL: Record<ShotField, string> = {
  ballSpeed: "Ball speed",
  launch: "Launch",
  spin: "Spin",
  spinAxis: "Spin axis",
  startLine: "Start line",
};

export function Hud({ distanceToPinYds, surface, shotNumber, selectedClub, expectedCarryYds, lastShot, onGreenInShots }: HudProps) {
  if (onGreenInShots !== null) {
    return (
      <div className="hud">
        <div className="hud-headline">On the green in {onGreenInShots}</div>
      </div>
    );
  }

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
          <b>#{shotNumber}</b>
          <span>shot</span>
        </div>
        <div className="hud-stat">
          <b>{selectedClub.name}</b>
          <span>~{Math.round(expectedCarryYds)} yds</span>
        </div>
      </div>

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
