/**
 * Shared engine behind tools/playtest.ts (Part A, single-hole deep dive)
 * and tools/course-playtest.ts (Part B, per-hole verification across the
 * whole course). No side effects on import -- pure simulation + analysis
 * functions only.
 */
import type { ClubId } from "@mulligan/shot-source";
import { CLUBS, DEFAULT_DISPERSION, SimulatedShotSource, enrichShot, isWedge, mulberry32 } from "@mulligan/shot-source";
import {
  clubAvailability,
  firstAvailableClub,
  headingToward,
  isPenaltySurface,
  isPuttable,
  resolvePenalty,
  resolvePutt,
  resolveShot,
  surfaceAt,
  type Hole,
  type Point2,
  type SurfaceType,
} from "@mulligan/game";

export const ROUNDS_PER_CONFIG = 400;
const SWING_FRACTIONS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ---------- expected carry (median over DEFAULT_DISPERSION, same idea as apps/web's expectedCarryYds) ----------

const carryCache = new Map<string, number>();

// A generous, surface-agnostic hole used only to measure carry (never played on).
const REFERENCE_HOLE: Hole = {
  id: "reference",
  name: "reference",
  par: 4,
  tee: { x: 0, y: 0 },
  pin: { x: 0, y: 1000 },
  surfaces: [{ type: "fairway", points: [{ x: -300, y: -100 }, { x: 300, y: -100 }, { x: 300, y: 1000 }, { x: -300, y: 1000 }] }],
  bounds: { minX: -400, maxX: 400, minY: -200, maxY: 1100 },
};

export function medianCarryYds(clubId: ClubId, swingFraction: number): number {
  const key = `${clubId}:${swingFraction}`;
  const cached = carryCache.get(key);
  if (cached !== undefined) return cached;

  const source = new SimulatedShotSource({ dispersion: DEFAULT_DISPERSION, seed: 7, fidelity: "full" });
  source.start();
  const carries: number[] = [];
  for (let i = 0; i < 25; i++) {
    const raw = source.hit(clubId, i, swingFraction);
    const shot = enrichShot(raw, clubId);
    const result = resolveShot(REFERENCE_HOLE, { x: 0, y: 0 }, 0, shot);
    carries.push(result.carryYds);
  }
  carries.sort((a, b) => a - b);
  const median = carries[Math.floor(carries.length / 2)]!;
  carryCache.set(key, median);
  return median;
}

export interface ClubChoice {
  clubId: ClubId;
  fraction: number;
  expectedCarry: number;
}

/** Every (club, swing fraction) option available at `surface`, with its expected carry. */
function optionsAt(surface: SurfaceType): ClubChoice[] {
  const out: ClubChoice[] = [];
  for (const club of CLUBS) {
    if (!clubAvailability(surface, club.id).available) continue;
    const fractions = isWedge(club.id) ? SWING_FRACTIONS : [1.0];
    for (const f of fractions) out.push({ clubId: club.id, fraction: f, expectedCarry: medianCarryYds(club.id, f) });
  }
  return out;
}

/** Standard policy: the club/fraction whose expected carry is closest to the distance, preferring not to overshoot. */
/**
 * Optional hazard-avoidance context: a competent player doesn't pick the
 * club whose expected carry flies straight into water/a bunker when a
 * shorter club in the bag would stay short of it. Without this, the
 * harness's "smart" policy is only hazard-aware on the tee shot
 * (teeShotOverride), and any hazard positioned near a natural approach
 * distance turns into a repeat-penalty loop no real player would walk
 * into twice -- found empirically while verifying Part B's new holes (see
 * docs/course-playtest-findings.md's first draft note).
 */
export interface HazardContext {
  hole: Hole;
  pos: Point2;
  pin: Point2;
}

// A carry that lands safely on fairway can still roll forward into water
// just past it -- a real gap found empirically (Part B's "Lay of the
// Land" kept finding water under "hazard-aware" club selection because
// the check only ever looked at the carry landing point). Rollout itself
// lives in @mulligan/game's resolver and isn't worth coupling this tool
// to; a flat margin approximating a typical fairway drive's rollout (see
// CLAUDE.md's M2b rollout table -- driver-on-fairway is ~20yd) is close
// enough for "would a competent player risk this club here." Scoped to
// water only, and only when the carry itself lands somewhere with real
// rollout (fairway/tee/green) -- bunkers and rough barely roll at all in
// the real model (M2b's rolloutMultiplier is ~0.1-0.3 there), so applying
// the same margin to them made hole 1's already-verified bunker read as
// reachable-by-rollout when it never was, and drove driver out of the bag
// there for no real reason.
const HAZARD_ROLLOUT_MARGIN_YDS = 25;

function landsInHazard(ctx: HazardContext, carryYds: number): boolean {
  const heading = headingToward(ctx.pos, ctx.pin);
  const carryLanding: Point2 = { x: ctx.pos.x + carryYds * Math.sin(heading), y: ctx.pos.y + carryYds * Math.cos(heading) };
  const carrySurface = surfaceAt(ctx.hole, carryLanding);
  if (carrySurface === "bunker" || carrySurface === "water" || carrySurface === "out") return true;

  if (carrySurface === "fairway" || carrySurface === "tee" || carrySurface === "green") {
    // Sample the whole rollout range, not just its far endpoint -- a
    // hazard band narrower than the margin sits entirely between the two
    // and a single-point check at carryYds+margin jumps clean over it.
    for (let step = 1; step <= 5; step++) {
      const d = carryYds + (HAZARD_ROLLOUT_MARGIN_YDS * step) / 5;
      const p: Point2 = { x: ctx.pos.x + d * Math.sin(heading), y: ctx.pos.y + d * Math.cos(heading) };
      if (surfaceAt(ctx.hole, p) === "water") return true;
    }
  }
  return false;
}

export function chooseClub(surface: SurfaceType, distanceYds: number, hazardCtx?: HazardContext): ClubChoice {
  const options = optionsAt(surface);
  if (options.length === 0) {
    const fallback = firstAvailableClub(surface, CLUBS);
    return { clubId: fallback, fraction: 1.0, expectedCarry: medianCarryYds(fallback, 1.0) };
  }
  const notOvershooting = options.filter((o) => o.expectedCarry <= distanceYds + 3);
  let pool = notOvershooting.length > 0 ? notOvershooting : options;
  if (hazardCtx) {
    const safe = pool.filter((o) => !landsInHazard(hazardCtx, o.expectedCarry));
    if (safe.length > 0) pool = safe; // else every option is a hazard -- nothing to do but accept it, same as a real player facing a fully-carrying hazard
  }
  pool.sort((a, b) => Math.abs(a.expectedCarry - distanceYds) - Math.abs(b.expectedCarry - distanceYds));
  return pool[0]!;
}

/** Longest available club/fraction whose expected carry stays under `maxCarryYds` (a safety margin already subtracted). */
export function chooseLayupClub(surface: SurfaceType, maxCarryYds: number): ClubChoice {
  const options = optionsAt(surface).filter((o) => o.expectedCarry <= maxCarryYds);
  if (options.length === 0) return chooseClub(surface, maxCarryYds);
  options.sort((a, b) => b.expectedCarry - a.expectedCarry);
  return options[0]!;
}

// ---------- aim policy ----------

export type AimPolicy = "pin" | "centerline" | "smart";

/** Midpoint of the widest fairway/tee/green band crossing y -- a cheap stand-in for "the fairway centerline here." */
export function fairwayCenterlineX(hole: Hole, y: number): number | null {
  const step = 0.5;
  let inSeg = false;
  let segStart = 0;
  let best: [number, number] | null = null;
  const consider = (a: number, b: number) => {
    if (!best || b - a > best[1] - best[0]) best = [a, b];
  };
  for (let x = hole.bounds.minX; x <= hole.bounds.maxX; x += step) {
    const s = surfaceAt(hole, { x, y });
    const fairwayish = s === "fairway" || s === "tee" || s === "green";
    if (fairwayish && !inSeg) {
      inSeg = true;
      segStart = x;
    } else if (!fairwayish && inSeg) {
      inSeg = false;
      consider(segStart, x);
    }
  }
  if (inSeg) consider(segStart, hole.bounds.maxX);
  return best ? (best[0] + best[1]) / 2 : null;
}

export function aimTarget(policy: AimPolicy, hole: Hole, pos: Point2, pin: Point2, expectedCarry: number): Point2 {
  const headingToPin = headingToward(pos, pin);
  const straightLanding: Point2 = {
    x: pos.x + expectedCarry * Math.sin(headingToPin),
    y: pos.y + expectedCarry * Math.cos(headingToPin),
  };

  function centerlineTarget(): Point2 {
    const targetY = Math.min(pin.y, straightLanding.y);
    const cx = fairwayCenterlineX(hole, targetY);
    return cx === null ? pin : { x: cx, y: targetY };
  }

  if (policy === "pin") return pin;
  if (policy === "centerline") return centerlineTarget();

  // smart: aim at the pin unless the straight line's expected landing spot is a hazard.
  const landingSurface = surfaceAt(hole, straightLanding);
  if (landingSurface === "bunker" || landingSurface === "water" || landingSurface === "out") return centerlineTarget();
  return pin;
}

// ---------- round simulation ----------

export interface StrokeRecord {
  club: ClubId | "putt";
  fromSurface: SurfaceType;
  distanceBeforeYds: number;
  penalty: "water" | "out" | null;
}

export interface RoundResult {
  totalStrokes: number;
  clubsUsed: Partial<Record<ClubId, number>>;
  strokes: StrokeRecord[];
  failed: boolean;
}

export interface RoundOptions {
  aimPolicy: AimPolicy;
  /** Force this club choice on the very first stroke (the tee shot); undefined = use the standard policy there too. */
  teeShotOverride?: "driver" | "layup";
  seed: number;
}

export function distanceTo(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** First-hazard distance (straight-line yards from the tee) along the tee->pin heading -- the layup target for that hole. */
export function hazardDistanceFromTee(hole: Hole): number | null {
  const heading = headingToward(hole.tee, hole.pin);
  const step = 1;
  const maxDist = distanceTo(hole.tee, hole.pin) + 50;
  for (let d = 10; d < maxDist; d += step) {
    const p: Point2 = { x: hole.tee.x + d * Math.sin(heading), y: hole.tee.y + d * Math.cos(heading) };
    const s = surfaceAt(hole, p);
    if (s === "bunker" || s === "water") return d;
  }
  return null;
}

export const LAYUP_SAFETY_MARGIN_YDS = 15;

export function simulateRound(hole: Hole, options: RoundOptions): RoundResult {
  const source = new SimulatedShotSource({ dispersion: DEFAULT_DISPERSION, seed: options.seed, fidelity: "device" });
  source.start();
  const puttRng = mulberry32(options.seed * 2 + 1);
  const hazardDist = hazardDistanceFromTee(hole);

  let pos: Point2 = { ...hole.tee };
  const clubsUsed: Partial<Record<ClubId, number>> = {};
  const strokes: StrokeRecord[] = [];
  let strokeIndex = 0;
  let safety = 0;

  while (safety < 40) {
    safety++;
    const surface = surfaceAt(hole, pos);
    const distance = distanceTo(pos, hole.pin);

    if (isPuttable(surface, distance)) {
      let puttDistance = distance;
      let holed = false;
      let n = 0;
      while (!holed && n < 8) {
        const result = resolvePutt(puttDistance, puttRng);
        strokes.push({ club: "putt", fromSurface: surface, distanceBeforeYds: puttDistance, penalty: null });
        n++;
        holed = result.holed;
        puttDistance = result.distanceAfter;
      }
      break;
    }

    const hazardCtx: HazardContext = { hole, pos, pin: hole.pin };
    let choice: ClubChoice;
    if (strokeIndex === 0 && options.teeShotOverride === "driver") {
      // Deliberately NOT hazard-avoiding -- this branch exists to measure what "always driver, no matter what" costs.
      choice = { clubId: "driver", fraction: 1.0, expectedCarry: medianCarryYds("driver", 1.0) };
      if (!clubAvailability(surface, "driver").available) choice = chooseClub(surface, distance, hazardCtx);
    } else if (strokeIndex === 0 && options.teeShotOverride === "layup" && hazardDist !== null) {
      choice = chooseLayupClub(surface, hazardDist - LAYUP_SAFETY_MARGIN_YDS);
    } else {
      choice = chooseClub(surface, distance, hazardCtx);
    }

    const target = aimTarget(options.aimPolicy, hole, pos, hole.pin, choice.expectedCarry);
    const aimHeading = headingToward(pos, target);

    const raw = source.hit(choice.clubId, strokeIndex, choice.fraction);
    const shot = enrichShot(raw, choice.clubId);
    const result = resolveShot(hole, pos, aimHeading, shot);

    clubsUsed[choice.clubId] = (clubsUsed[choice.clubId] ?? 0) + 1;

    let penalty: "water" | "out" | null = null;
    if (isPenaltySurface(result.restSurface)) {
      const resolution = resolvePenalty(result.restSurface, pos, result.rest);
      penalty = resolution.kind;
      pos = resolution.nextBallPos;
    } else {
      pos = result.rest;
    }

    strokes.push({ club: choice.clubId, fromSurface: surface, distanceBeforeYds: distance, penalty });
    strokeIndex++;
  }

  return { totalStrokes: strokes.length, clubsUsed, strokes, failed: safety >= 40 };
}

export function runConfig(hole: Hole, options: Omit<RoundOptions, "seed">, rounds: number): RoundResult[] {
  const results: RoundResult[] = [];
  for (let i = 0; i < rounds; i++) results.push(simulateRound(hole, { ...options, seed: 5000 + i }));
  return results;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---------- analysis ----------

export function analyzeClubUsage(results: RoundResult[]): Record<ClubId, number> {
  const totals: Partial<Record<ClubId, number>> = {};
  for (const r of results) for (const [club, n] of Object.entries(r.clubsUsed)) totals[club as ClubId] = (totals[club as ClubId] ?? 0) + n!;
  const out = {} as Record<ClubId, number>;
  for (const club of CLUBS) out[club.id] = totals[club.id] ?? 0;
  return out;
}

export function scoreDistribution(results: RoundResult[], par: number) {
  const buckets = { eagleOrBetter: 0, birdie: 0, par: 0, bogey: 0, doubleOrWorse: 0 };
  for (const r of results) {
    const diff = r.totalStrokes - par;
    if (diff <= -2) buckets.eagleOrBetter++;
    else if (diff === -1) buckets.birdie++;
    else if (diff === 0) buckets.par++;
    else if (diff === 1) buckets.bogey++;
    else buckets.doubleOrWorse++;
  }
  return buckets;
}

export function distanceBucket(yds: number): string {
  if (yds > 200) return ">200";
  if (yds > 150) return "150-200";
  if (yds > 100) return "100-150";
  if (yds > 60) return "60-100";
  if (yds > 30) return "30-60";
  return "0-30";
}

export function penaltyAttribution(results: RoundResult[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    for (const s of r.strokes) {
      if (!s.penalty) continue;
      const key = `${s.fromSurface} @ ${distanceBucket(s.distanceBeforeYds)}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return map;
}

export function fmtPct(n: number, total: number): string {
  return `${((100 * n) / total).toFixed(1)}%`;
}
