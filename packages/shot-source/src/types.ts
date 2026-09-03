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
  /**
   * Degrees, relative to the player's chosen aim line — NOT an absolute
   * compass heading. Positive is right of aim. At the range every bay
   * points the same physical direction, so the player aims in the app
   * (`aimHeadingRad` in hole space) and the device only measures how far
   * off *that* line the ball actually started. From the phone-behind-ball
   * CV subsystem; absent until that ships.
   */
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
  /** Degrees, relative to the player's chosen aim line — see RawShotEvent. */
  startLineDeg: number;
  clubId: ClubId;
  timestamp: number;
  /** Which fields were measured vs estimated. Needed for UI honesty and for calibration. */
  provenance: Record<ShotField, Provenance>;
}
