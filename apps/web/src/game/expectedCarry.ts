import { degToRad, metersToYards, mphToMps, rpmToRadPerSec, simulate } from "@mulligan/physics";
import { DEFAULT_DISPERSION, findClub, mulberry32, simulateShot, type ClubId } from "@mulligan/shot-source";

const SAMPLES = 101; // odd, so the middle index is a clean median, no averaging of two values

/** Stable per-club seed so the displayed median doesn't jitter between renders or reloads. */
function seedFromClubId(clubId: string): number {
  let hash = 0;
  for (let i = 0; i < clubId.length; i++) {
    hash = (hash * 31 + clubId.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Median carry across DEFAULT_DISPERSION's simulated shots for this club --
 * NOT the noiseless preset (which is optimistic; the median simulated
 * drive carries noticeably less than the preset's exact 224.4 for driver).
 */
export function expectedCarryYds(clubId: ClubId): number {
  const club = findClub(clubId);
  const rng = mulberry32(seedFromClubId(clubId));

  const carries: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const raw = simulateShot(club, DEFAULT_DISPERSION, rng, 0);
    const trajectory = simulate({
      ballSpeed: mphToMps(raw.ballSpeedMph),
      launchAngle: degToRad(raw.launchDeg),
      spinRate: rpmToRadPerSec(raw.spinRpm!),
      spinAxis: degToRad(raw.spinAxisDeg!),
      startLine: degToRad(raw.startLineDeg!),
    });
    carries.push(metersToYards(trajectory.carry));
  }

  carries.sort((a, b) => a - b);
  return carries[Math.floor(carries.length / 2)]!;
}
