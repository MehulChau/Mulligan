import { degToRad, metersToYards, mphToMps, rpmToRadPerSec, simulate } from "@mulligan/physics";
import { CLUBS, DEFAULT_DISPERSION, mulberry32, simulateShot, type ClubId, type ClubProfile } from "@mulligan/shot-source";

const SAMPLES = 101; // odd, so the middle index is a clean median, no averaging of two values

/** Stable per-club seed so the table is deterministic across reloads. */
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

// The result depends only on club id and is deterministic (seeded), so the
// whole table is computed once here, at module load, instead of per-club
// on demand -- 101 simulations/club (1.56M integration steps total across
// the bag) is cheap once at startup but is not free enough to redo on a
// render or a club selection.
const EXPECTED_CARRY_TABLE: Record<ClubId, number> = Object.fromEntries(
  CLUBS.map((club) => [club.id, medianCarryYds(club)]),
) as Record<ClubId, number>;

/**
 * Median carry across DEFAULT_DISPERSION's simulated shots for this club --
 * NOT the noiseless preset (which is optimistic; the median simulated
 * drive carries noticeably less than the preset's exact 224.4 for driver).
 */
export function expectedCarryYds(clubId: ClubId): number {
  return EXPECTED_CARRY_TABLE[clubId];
}
