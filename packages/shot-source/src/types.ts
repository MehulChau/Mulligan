import type { ClubId } from "./clubs";

/**
 * Exactly what the Raspberry Pi measures and transmits. Nothing else — the
 * device doesn't know which club you hit (you selected that in the app) and
 * can't measure spin, so it physically cannot populate those fields.
 */
export interface RawShotEvent {
  ballSpeedMph: number;
  launchDeg: number;
  timestamp: number;
  /** From the phone-behind-ball CV subsystem; absent until that ships. */
  startLineDeg?: number;
  /** Real spin measurement is a v2+ stretch; absent for now. */
  spinRpm?: number;
  spinAxisDeg?: number;
}

export type ShotField = "ballSpeed" | "launch" | "spin" | "spinAxis" | "startLine";
export type Provenance = "measured" | "estimated";

/** What the game consumes. Complete, no optionals. */
export interface ShotEvent {
  ballSpeedMph: number;
  launchDeg: number;
  spinRpm: number;
  spinAxisDeg: number;
  startLineDeg: number;
  clubId: ClubId;
  timestamp: number;
  /** Which fields were measured vs estimated. Needed for UI honesty and for calibration. */
  provenance: Record<ShotField, Provenance>;
}
