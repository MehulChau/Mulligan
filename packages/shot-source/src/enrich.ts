import { findClub, type ClubId } from "./clubs";
import { estimateSpin } from "./spin/estimate";
import type { RawShotEvent, ShotEvent } from "./types";

/**
 * Fills in what the device can't measure: spin (estimated from measured
 * ball speed and launch angle alone -- see spin/estimate.ts; clubId plays
 * no part in this, since which club the player picked is a statement of
 * intent, not a measurement), spin axis (defaults straight, 0deg), and
 * start line (defaults straight, 0deg, until the phone-behind-ball CV
 * subsystem ships). Every field is tagged so the UI and the calibration
 * harness both know what was actually measured.
 */
export function enrichShot(raw: RawShotEvent, clubId: ClubId): ShotEvent {
  findClub(clubId); // validates clubId (throws on an unknown one) -- its profile is deliberately not used for spin, see below

  const spinRpm = raw.spinRpm ?? estimateSpin(raw.ballSpeedMph, raw.launchDeg).spinRpm;
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
