import { findClub, type ClubId } from "./clubs";
import type { RawShotEvent, ShotEvent } from "./types";

/**
 * Fills in what the device can't measure: spin (estimated from the selected
 * club, scaled by how hard this swing was relative to the club's reference
 * ball speed — a harder swing spins more), spin axis (defaults straight,
 * 0deg), and start line (defaults straight, 0deg, until the phone-behind-ball
 * CV subsystem ships). Every field is tagged so the UI and the calibration
 * harness both know what was actually measured.
 */
export function enrichShot(raw: RawShotEvent, clubId: ClubId): ShotEvent {
  const club = findClub(clubId);

  const spinRpm = raw.spinRpm ?? club.spinRpm * (raw.ballSpeedMph / club.ballSpeedMph);
  const spinAxisDeg = raw.spinAxisDeg ?? 0;
  const startLineDeg = raw.startLineDeg ?? 0;

  return {
    ballSpeedMph: raw.ballSpeedMph,
    launchDeg: raw.launchDeg,
    spinRpm,
    spinAxisDeg,
    startLineDeg,
    clubId,
    timestamp: raw.timestamp,
    provenance: {
      ballSpeed: "measured",
      launch: "measured",
      spin: raw.spinRpm === undefined ? "estimated" : "measured",
      spinAxis: raw.spinAxisDeg === undefined ? "estimated" : "measured",
      startLine: raw.startLineDeg === undefined ? "estimated" : "measured",
    },
  };
}
