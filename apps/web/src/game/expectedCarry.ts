import { degToRad, metersToYards, mphToMps, rpmToRadPerSec, simulate } from "@mulligan/physics";
import {
  DEFAULT_DISPERSION,
  FULL_SWING_FRACTION,
  clampSwingFraction,
  findClub,
  mulberry32,
  scaleClubForSwing,
  scaleDispersionForSwing,
  simulateShot,
  type ClubId,
  type ClubProfile,
  type DispersionParams,
} from "@mulligan/shot-source";

// A median doesn't need many samples -- 31 vs. 101 moves the result by well
// under a yard, and it's a 3x cut on top of computing lazily below.
const SAMPLES = 31; // odd, so the middle index is a clean median, no averaging of two values

// The swing-fraction slider steps by 5%; rounding a request to the same
// grid means a drag gesture hits the same handful of cache keys instead of
// minting a new one (and paying ~9ms of simulation) on every pixel of
// movement.
const FRACTION_CACHE_STEP = 0.05;

/** Stable per-(club, fraction) seed so a cached value is deterministic across reloads. */
function seedFromKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function medianCarryYds(club: ClubProfile, dispersion: DispersionParams, seed: number): number {
  const rng = mulberry32(seed);

  const carries: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const raw = simulateShot(club, dispersion, rng, 0);
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

function roundToFractionStep(fraction: number): number {
  return Math.round(fraction / FRACTION_CACHE_STEP) * FRACTION_CACHE_STEP;
}

// The HUD only ever shows one club/fraction pair at a time, so computing
// every possibility up front would waste almost all of the work and, worse,
// block first paint -- for an app whose whole premise is a quick glance
// between range balls, that's the wrong trade. Compute lazily on first
// request per (club, fraction) and cache it here: first tap on a new value
// costs ~9ms (31 simulations), every repeat after is free, and startup cost
// is zero.
const cache = new Map<string, number>();

/**
 * Median carry across DEFAULT_DISPERSION's simulated shots for this club at
 * this swing fraction -- NOT the noiseless preset (which is optimistic; the
 * median simulated drive carries noticeably less than the preset's exact
 * 224.4 for driver). `swingFraction` defaults to a full swing; only wedges
 * ever get a fraction below that from the UI.
 */
export function expectedCarryYds(clubId: ClubId, swingFraction: number = FULL_SWING_FRACTION): number {
  const fraction = roundToFractionStep(clampSwingFraction(swingFraction));
  const key = `${clubId}:${fraction.toFixed(2)}`;

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const baseClub = findClub(clubId);
  const club = fraction === FULL_SWING_FRACTION ? baseClub : scaleClubForSwing(baseClub, fraction);
  const dispersion =
    fraction === FULL_SWING_FRACTION ? DEFAULT_DISPERSION : scaleDispersionForSwing(DEFAULT_DISPERSION, fraction);

  const value = medianCarryYds(club, dispersion, seedFromKey(key));
  cache.set(key, value);
  return value;
}
