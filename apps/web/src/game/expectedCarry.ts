import { degToRad, metersToYards, mphToMps, rpmToRadPerSec, simulate } from "@mulligan/physics";
import { DEFAULT_DISPERSION, findClub, mulberry32, simulateShot, type ClubId, type ClubProfile } from "@mulligan/shot-source";

// A median doesn't need many samples -- 31 vs. 101 moves the result by well
// under a yard, and it's a 3x cut on top of computing lazily below.
const SAMPLES = 31; // odd, so the middle index is a clean median, no averaging of two values

/** Stable per-club seed so a club's cached value is deterministic across reloads. */
function seedFromClubId(clubId: string): number {
  let hash = 0;
  for (let i = 0; i < clubId.length; i++) {
    hash = (hash * 31 + clubId.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function medianCarryYds(club: ClubProfile): number {
  const rng = mulberry32(seedFromClubId(club.id));

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

// The HUD only ever shows one club's number at a time, so computing all
// twelve at module load (the previous approach) wasted eleven-twelfths of
// the work and, worse, blocked first paint on it -- for an app whose whole
// premise is a quick glance between range balls, that's the wrong trade.
// Compute lazily on first request per club and cache it here: first tap on
// a new club costs ~9ms (31 simulations), every tap after is free, and
// startup cost is zero.
const cache = new Map<ClubId, number>();

/**
 * Median carry across DEFAULT_DISPERSION's simulated shots for this club --
 * NOT the noiseless preset (which is optimistic; the median simulated
 * drive carries noticeably less than the preset's exact 224.4 for driver).
 */
export function expectedCarryYds(clubId: ClubId): number {
  const cached = cache.get(clubId);
  if (cached !== undefined) return cached;

  const value = medianCarryYds(findClub(clubId));
  cache.set(clubId, value);
  return value;
}
