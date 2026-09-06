/**
 * Part A: headless playtest harness. Plays many simulated rounds of a hole
 * against a simple, explicit decision policy and reports what actually
 * happens -- club usage, whether the dogleg/tee-shot decisions matter, the
 * score distribution, and where strokes get lost. This is an analysis
 * tool, not part of the shipped app; its output is docs/playtest-findings.md,
 * not a feature.
 *
 * Run: npm run playtest
 */
import type { ClubId } from "@mulligan/shot-source";
import { CLUBS, DEFAULT_DISPERSION, SimulatedShotSource, enrichShot, findClub, isWedge, mulberry32 } from "@mulligan/shot-source";
import {
  clubAvailability,
  firstAvailableClub,
  headingToward,
  HOLE_1,
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
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUNDS_PER_CONFIG = 400;
const SWING_FRACTIONS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ---------- expected carry (median over DEFAULT_DISPERSION, same idea as apps/web's expectedCarryYds) ----------

const carryCache = new Map<string, number>();

function medianCarryYds(clubId: ClubId, swingFraction: number): number {
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

interface ClubChoice {
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
function chooseClub(surface: SurfaceType, distanceYds: number): ClubChoice {
  const options = optionsAt(surface);
  if (options.length === 0) {
    const fallback = firstAvailableClub(surface, CLUBS);
    return { clubId: fallback, fraction: 1.0, expectedCarry: medianCarryYds(fallback, 1.0) };
  }
  const notOvershooting = options.filter((o) => o.expectedCarry <= distanceYds + 3);
  const pool = notOvershooting.length > 0 ? notOvershooting : options;
  pool.sort((a, b) => Math.abs(a.expectedCarry - distanceYds) - Math.abs(b.expectedCarry - distanceYds));
  return pool[0]!;
}

/** Longest available club/fraction whose expected carry stays under `maxCarryYds` (a safety margin already subtracted). */
function chooseLayupClub(surface: SurfaceType, maxCarryYds: number): ClubChoice {
  const options = optionsAt(surface).filter((o) => o.expectedCarry <= maxCarryYds);
  if (options.length === 0) return chooseClub(surface, maxCarryYds);
  options.sort((a, b) => b.expectedCarry - a.expectedCarry);
  return options[0]!;
}

// ---------- aim policy ----------

type AimPolicy = "pin" | "centerline" | "smart";

/** Midpoint of the widest fairway/tee/green band crossing y -- a cheap stand-in for "the fairway centerline here." */
function fairwayCenterlineX(hole: Hole, y: number): number | null {
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

function aimTarget(policy: AimPolicy, hole: Hole, pos: Point2, pin: Point2, expectedCarry: number): Point2 {
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

interface StrokeRecord {
  club: ClubId | "putt";
  fromSurface: SurfaceType;
  distanceBeforeYds: number;
  penalty: "water" | "out" | null;
}

interface RoundResult {
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

function distanceTo(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** First-hazard distance (straight-line yards from the tee) along the tee->pin heading -- the layup target for that hole. */
function hazardDistanceFromTee(hole: Hole): number | null {
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

const LAYUP_SAFETY_MARGIN_YDS = 15;

function simulateRound(hole: Hole, options: RoundOptions): RoundResult {
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

    let choice: ClubChoice;
    if (strokeIndex === 0 && options.teeShotOverride === "driver") {
      choice = { clubId: "driver", fraction: 1.0, expectedCarry: medianCarryYds("driver", 1.0) };
      if (!clubAvailability(surface, "driver").available) choice = chooseClub(surface, distance);
    } else if (strokeIndex === 0 && options.teeShotOverride === "layup" && hazardDist !== null) {
      choice = chooseLayupClub(surface, hazardDist - LAYUP_SAFETY_MARGIN_YDS);
    } else {
      choice = chooseClub(surface, distance);
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

function runConfig(hole: Hole, options: Omit<RoundOptions, "seed">, rounds: number): RoundResult[] {
  const results: RoundResult[] = [];
  for (let i = 0; i < rounds; i++) results.push(simulateRound(hole, { ...options, seed: 5000 + i }));
  return results;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---------- Part A analysis ----------

function analyzeClubUsage(results: RoundResult[]): Record<ClubId, number> {
  const totals: Partial<Record<ClubId, number>> = {};
  for (const r of results) for (const [club, n] of Object.entries(r.clubsUsed)) totals[club as ClubId] = (totals[club as ClubId] ?? 0) + n!;
  const out = {} as Record<ClubId, number>;
  for (const club of CLUBS) out[club.id] = totals[club.id] ?? 0;
  return out;
}

function scoreDistribution(results: RoundResult[], par: number) {
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

function distanceBucket(yds: number): string {
  if (yds > 200) return ">200";
  if (yds > 150) return "150-200";
  if (yds > 100) return "100-150";
  if (yds > 60) return "60-100";
  if (yds > 30) return "30-60";
  return "0-30";
}

function penaltyAttribution(results: RoundResult[]): Map<string, number> {
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

function fmtPct(n: number, total: number): string {
  return `${((100 * n) / total).toFixed(1)}%`;
}

function main() {
  const hole = HOLE_1;
  const par = hole.par;

  console.log(`Playtesting ${hole.name} (par ${par}), ${ROUNDS_PER_CONFIG} rounds per configuration...`);

  // Q1 + Q4 + Q5: the recommended policy (smart aim, standard club selection throughout).
  const smart = runConfig(hole, { aimPolicy: "smart" }, ROUNDS_PER_CONFIG);
  const failedSmart = smart.filter((r) => r.failed).length;

  // Q2: does the dogleg matter? pin-only vs centerline-only aim, every shot, same club policy.
  const pinOnly = runConfig(hole, { aimPolicy: "pin" }, ROUNDS_PER_CONFIG);
  const centerlineOnly = runConfig(hole, { aimPolicy: "centerline" }, ROUNDS_PER_CONFIG);

  // Q3: is driver always right off the tee? always-driver vs layup-short-of-bunker, both under the smart aim policy otherwise.
  const alwaysDriver = runConfig(hole, { aimPolicy: "smart", teeShotOverride: "driver" }, ROUNDS_PER_CONFIG);
  const layup = runConfig(hole, { aimPolicy: "smart", teeShotOverride: "layup" }, ROUNDS_PER_CONFIG);

  const clubUsage = analyzeClubUsage(smart);
  const totalShots = Object.values(clubUsage).reduce((a, b) => a + b, 0);
  const unusedClubs = CLUBS.filter((c) => clubUsage[c.id] === 0).map((c) => c.name);

  const meanPin = mean(pinOnly.map((r) => r.totalStrokes));
  const meanCenterline = mean(centerlineOnly.map((r) => r.totalStrokes));

  const meanDriver = mean(alwaysDriver.map((r) => r.totalStrokes));
  const meanLayup = mean(layup.map((r) => r.totalStrokes));

  const dist = scoreDistribution(smart, par);
  const penalties = penaltyAttribution(smart);
  const totalPenalties = [...penalties.values()].reduce((a, b) => a + b, 0);

  const hazardDist = hazardDistanceFromTee(hole);

  const lines: string[] = [];
  lines.push(`# Playtest findings — ${hole.name} (par ${par})`);
  lines.push("");
  lines.push(`Generated by \`tools/playtest.ts\` (\`npm run playtest\`), ${ROUNDS_PER_CONFIG} simulated rounds per configuration, Simulated shot source with \`DEFAULT_DISPERSION\`. Policy: pick the club/swing-fraction whose expected (median) carry is closest to the distance to the pin without overshooting; aim at the pin unless the straight line's expected landing spot is a bunker/water/out (then aim at the fairway centerline at that distance) — this is the "smart" policy used for every question except Q2 and Q3, which isolate one decision at a time.`);
  lines.push("");
  if (failedSmart > 0) lines.push(`**${failedSmart}/${ROUNDS_PER_CONFIG} rounds never finished (25-stroke safety valve hit) under the smart policy.**`);
  lines.push("");

  lines.push("## Q1 — Club usage distribution");
  lines.push("");
  lines.push("| club | shots | % of all shots |");
  lines.push("|---|---|---|");
  for (const club of CLUBS) {
    lines.push(`| ${club.name} | ${clubUsage[club.id]} | ${fmtPct(clubUsage[club.id], totalShots)} |`);
  }
  lines.push("");
  lines.push(
    unusedClubs.length > 0
      ? `**${unusedClubs.length} club(s) never came out of the bag: ${unusedClubs.join(", ")}.**`
      : "Every club got used at least once.",
  );
  lines.push("");

  lines.push("## Q2 — Does the dogleg matter?");
  lines.push("");
  lines.push(`Aim-at-pin every shot: mean ${meanPin.toFixed(2)} strokes. Aim-at-fairway-centerline every shot: mean ${meanCenterline.toFixed(2)} strokes. Difference: ${Math.abs(meanPin - meanCenterline).toFixed(2)} strokes.`);
  lines.push("");

  lines.push("## Q3 — Is driver always right off the tee?");
  lines.push("");
  lines.push(
    hazardDist === null
      ? "No hazard found along the tee-to-pin line -- layup policy fell back to the standard club choice; this question doesn't apply to this hole as authored."
      : `Hazard (bunker) found ${hazardDist.toFixed(0)}yd from the tee along the direct line. Always-driver off the tee: mean ${meanDriver.toFixed(2)} strokes. Layup short of the bunker (longest club carrying under ${(hazardDist - LAYUP_SAFETY_MARGIN_YDS).toFixed(0)}yd): mean ${meanLayup.toFixed(2)} strokes. Difference: ${Math.abs(meanDriver - meanLayup).toFixed(2)} strokes.`,
  );
  lines.push("");

  lines.push("## Q4 — Score distribution shape");
  lines.push("");
  lines.push("| result | rounds | % |");
  lines.push("|---|---|---|");
  lines.push(`| eagle or better | ${dist.eagleOrBetter} | ${fmtPct(dist.eagleOrBetter, ROUNDS_PER_CONFIG)} |`);
  lines.push(`| birdie | ${dist.birdie} | ${fmtPct(dist.birdie, ROUNDS_PER_CONFIG)} |`);
  lines.push(`| par | ${dist.par} | ${fmtPct(dist.par, ROUNDS_PER_CONFIG)} |`);
  lines.push(`| bogey | ${dist.bogey} | ${fmtPct(dist.bogey, ROUNDS_PER_CONFIG)} |`);
  lines.push(`| double or worse | ${dist.doubleOrWorse} | ${fmtPct(dist.doubleOrWorse, ROUNDS_PER_CONFIG)} |`);
  lines.push("");

  lines.push("## Q5 — Where do rounds actually go wrong?");
  lines.push("");
  lines.push(`${totalPenalties} penalty stroke(s) across ${ROUNDS_PER_CONFIG} rounds, attributed to the surface and distance-to-pin of the shot that caused them:`);
  lines.push("");
  if (totalPenalties === 0) {
    lines.push("None. No shot in any simulated round found water or out of bounds.");
  } else {
    lines.push("| from surface @ distance | penalty strokes | % of all penalties |");
    lines.push("|---|---|---|");
    const sorted = [...penalties.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, n] of sorted) lines.push(`| ${key} | ${n} | ${fmtPct(n, totalPenalties)} |`);
  }
  lines.push("");

  lines.push("## Verdict");
  lines.push("");
  const verdictPoints: string[] = [];
  if (unusedClubs.length > 0) {
    verdictPoints.push(
      `${unusedClubs.length} of 12 clubs (${unusedClubs.join(", ")}) never get pulled -- the hole's approach distances don't visit that part of the bag at all.`,
    );
  }
  const doglegMargin = Math.abs(meanPin - meanCenterline);
  verdictPoints.push(
    doglegMargin < 0.1
      ? `The dogleg is decoration: aiming at the pin the entire round costs ${doglegMargin.toFixed(2)} strokes on average versus deliberately aiming at the fairway centerline -- essentially nothing. The bend does not ask the player to choose a line.`
      : `The dogleg is a real decision: pin-aim vs. centerline-aim differ by ${doglegMargin.toFixed(2)} strokes on average.`,
  );
  const teeMargin = Math.abs(meanDriver - meanLayup);
  verdictPoints.push(
    hazardDist !== null && teeMargin < 0.1
      ? `The tee shot is not a decision: always hitting driver costs ${teeMargin.toFixed(2)} strokes on average versus deliberately laying up short of the bunker -- essentially nothing. There is a hazard in range of the driver on paper, but it never actually changes the right play.`
      : hazardDist !== null
        ? `The tee shot is a real decision: driver vs. layup differ by ${teeMargin.toFixed(2)} strokes on average.`
        : `The tee shot has no hazard to weigh driver against, as authored.`,
  );
  if (totalPenalties === 0) {
    verdictPoints.push(
      "No simulated round, out of 400, ever incurred a stroke penalty. The hole's only hazard (the bunker) is a lie restriction, not a scoring threat -- missing badly costs a lie change, never a stroke. There is currently no way to actually lose a stroke to a bad shot on this hole short of a putting meltdown.",
    );
  }
  verdictPoints.push(
    `${fmtPct(dist.par, ROUNDS_PER_CONFIG)} of rounds finish exactly at par and only ${fmtPct(dist.doubleOrWorse, ROUNDS_PER_CONFIG)} finish double-or-worse -- a narrow, front-loaded distribution, not a wide one.`,
  );
  for (const p of verdictPoints) lines.push(`- ${p}`);
  lines.push("");
  const playsItself = doglegMargin < 0.1 && teeMargin < 0.1 && totalPenalties === 0 && unusedClubs.length >= 2;
  lines.push(
    playsItself
      ? "**Plainly: this hole plays itself.** Every decision this harness could isolate -- which line to take off the tee, whether to challenge the bunker, which club to hit into the green -- came back with either no measurable cost to the \"obvious\" choice or a bag that never gets touched in the middle. The hole is not defective (it produces a real score, penalties are correctly wired, putting works), it's just not *asking anything*. That is the honest finding this part exists to produce, and it means Part B's six holes need to be authored so that at least one of these five axes (club variety, line choice, tee-shot risk, hazard consequence, score spread) is genuinely live on each of them -- not by making this hole harder after the fact, but by making sure the new holes don't repeat the same shape."
      : "This hole shows at least one live decision axis under this harness -- see the specific numbers above for which one(s), and lean on that shape when authoring Part B's holes.",
  );
  lines.push("");

  writeFileSync(resolve(process.cwd(), "docs/playtest-findings.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`\nWritten to docs/playtest-findings.md`);
}

main();
