/**
 * CLUBS (packages/shot-source/src/clubs.ts) describes a generic ~150mph-
 * driver player, not whoever is actually playing. The aero calibration
 * (`npm run calibrate`) fits the flight model to measured ball speed and
 * launch -- it does NOT correct the presets, so a good aero fit still
 * shows a stranger's distances on every club.
 *
 * This tool takes three measured clubs (driver, 7-iron, a wedge) and
 * proposes a full twelve-club table scaled to fit them. It prints for
 * review -- same posture as `npm run calibrate` -- and never writes
 * clubs.ts itself.
 *
 * Usage:
 *   npm run rescale-clubs -- \
 *     --driverSpeed=165 --driverLaunch=11.5 \
 *     --sevenIronSpeed=118 --sevenIronLaunch=17.5 \
 *     --wedgeClub=pw --wedgeSpeed=92 --wedgeLaunch=25
 *
 * --wedgeClub accepts pw/gw/sw/lw -- whichever wedge you actually hit at
 * the range. Ball speed in mph, launch in degrees.
 */
import { CLUBS, type ClubId, type ClubProfile } from "@mulligan/shot-source";

const WEDGE_CLUB_IDS: ClubId[] = ["pw", "gw", "sw", "lw"];

interface Args {
  driverSpeed: number;
  driverLaunch: number;
  sevenIronSpeed: number;
  sevenIronLaunch: number;
  wedgeClub: ClubId;
  wedgeSpeed: number;
  wedgeLaunch: number;
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  npm run rescale-clubs -- \\",
      "    --driverSpeed=<mph> --driverLaunch=<deg> \\",
      "    --sevenIronSpeed=<mph> --sevenIronLaunch=<deg> \\",
      "    --wedgeClub=<pw|gw|sw|lw> --wedgeSpeed=<mph> --wedgeLaunch=<deg>",
      "",
      "Example:",
      "  npm run rescale-clubs -- --driverSpeed=165 --driverLaunch=11.5 \\",
      "    --sevenIronSpeed=118 --sevenIronLaunch=17.5 \\",
      "    --wedgeClub=pw --wedgeSpeed=92 --wedgeLaunch=25",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([A-Za-z]+)=(.+)$/.exec(arg);
    if (match) map.set(match[1]!, match[2]!);
  }

  function requireNumber(key: string): number {
    const raw = map.get(key);
    if (raw === undefined) printUsageAndExit(`missing --${key}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) printUsageAndExit(`--${key} must be a number, got "${raw}"`);
    return value;
  }

  const wedgeClubRaw = map.get("wedgeClub");
  if (wedgeClubRaw === undefined) printUsageAndExit("missing --wedgeClub");
  if (!WEDGE_CLUB_IDS.includes(wedgeClubRaw as ClubId)) {
    printUsageAndExit(`--wedgeClub must be one of ${WEDGE_CLUB_IDS.join(", ")}, got "${wedgeClubRaw}"`);
  }

  return {
    driverSpeed: requireNumber("driverSpeed"),
    driverLaunch: requireNumber("driverLaunch"),
    sevenIronSpeed: requireNumber("sevenIronSpeed"),
    sevenIronLaunch: requireNumber("sevenIronLaunch"),
    wedgeClub: wedgeClubRaw as ClubId,
    wedgeSpeed: requireNumber("wedgeSpeed"),
    wedgeLaunch: requireNumber("wedgeLaunch"),
  };
}

interface Anchor {
  index: number;
  clubId: ClubId;
  speedRatio: number; // measured / baseline
  launchDeltaDeg: number; // measured - baseline, undamped
}

/**
 * Applies ONLY to the nine clubs you didn't measure -- not the three
 * anchors. A launch delta observed on a club you actually hit is real
 * evidence (docs/range-session.md already has you take the median across
 * 8-10 shots, not one), so an anchor club's proposed launch is the raw
 * measured delta at full strength, undamped. Extrapolating that same
 * delta to a club you never hit is a different, weaker claim -- launch
 * angle differences between players are real but noisier and less
 * durable than ball speed differences (attack angle and strike quality
 * shift it in a way ball speed mostly isn't shifted by), so the delta
 * used for interpolation/extrapolation between and beyond anchors is
 * damped by this factor. The tool prints both the raw and damped numbers
 * at each anchor so this is never hidden.
 */
const LAUNCH_DELTA_DAMPING = 0.5;

function indexOf(clubId: ClubId): number {
  const index = CLUBS.findIndex((c) => c.id === clubId);
  if (index < 0) throw new Error(`rescale-clubs: unknown clubId "${clubId}"`);
  return index;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates a per-club correction between two bracketing anchors by club position; flat-extrapolates beyond either end. */
function correctionAt(index: number, anchors: Anchor[], pick: (a: Anchor) => number): number {
  if (index <= anchors[0]!.index) return pick(anchors[0]!);
  if (index >= anchors[anchors.length - 1]!.index) return pick(anchors[anchors.length - 1]!);

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (index >= a.index && index <= b.index) {
      const t = (index - a.index) / (b.index - a.index);
      return lerp(pick(a), pick(b), t);
    }
  }
  return pick(anchors[anchors.length - 1]!); // unreachable given the bounds checks above
}

/**
 * The launch delta actually applied to a club: the raw measured delta,
 * full strength, at an anchor club itself; the damped, interpolated/
 * extrapolated delta everywhere else. See LAUNCH_DELTA_DAMPING's doc
 * comment for why these two cases get different treatment.
 */
function launchDeltaAt(index: number, anchors: Anchor[]): number {
  const exact = anchors.find((a) => a.index === index);
  if (exact) return exact.launchDeltaDeg;
  return correctionAt(index, anchors, (a) => a.launchDeltaDeg) * LAUNCH_DELTA_DAMPING;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const driverBaseline = CLUBS[indexOf("driver")]!;
  const sevenIronBaseline = CLUBS[indexOf("7i")]!;
  const wedgeBaseline = CLUBS[indexOf(args.wedgeClub)]!;

  const anchors: Anchor[] = [
    {
      index: indexOf("driver"),
      clubId: "driver" as ClubId,
      speedRatio: args.driverSpeed / driverBaseline.ballSpeedMph,
      launchDeltaDeg: args.driverLaunch - driverBaseline.launchDeg,
    },
    {
      index: indexOf("7i"),
      clubId: "7i" as ClubId,
      speedRatio: args.sevenIronSpeed / sevenIronBaseline.ballSpeedMph,
      launchDeltaDeg: args.sevenIronLaunch - sevenIronBaseline.launchDeg,
    },
    {
      index: indexOf(args.wedgeClub),
      clubId: args.wedgeClub,
      speedRatio: args.wedgeSpeed / wedgeBaseline.ballSpeedMph,
      launchDeltaDeg: args.wedgeLaunch - wedgeBaseline.launchDeg,
    },
  ].sort((a, b) => a.index - b.index);

  console.log("Anchors (measured vs. current CLUBS preset):");
  for (const a of anchors) {
    const baseline = CLUBS[a.index]!;
    console.log(
      `  ${a.clubId.padEnd(6)} speed ratio ${a.speedRatio.toFixed(3)}x` +
        `   launch delta ${a.launchDeltaDeg >= 0 ? "+" : ""}${a.launchDeltaDeg.toFixed(1)}deg` +
        ` (used at full strength here; damped ${LAUNCH_DELTA_DAMPING}x -> ${(a.launchDeltaDeg * LAUNCH_DELTA_DAMPING >= 0 ? "+" : "") + (a.launchDeltaDeg * LAUNCH_DELTA_DAMPING).toFixed(1)}deg only when carried to OTHER clubs)` +
        `   baseline ${baseline.ballSpeedMph}mph / ${baseline.launchDeg}deg`,
    );
  }
  console.log();

  console.log("Proposed twelve-club table (ball speed / launch / spin):");
  console.log("club        speed(mph)  launch(deg)  spin(rpm)   note");
  const proposed: ClubProfile[] = CLUBS.map((baseline, index) => {
    const speedRatio = correctionAt(index, anchors, (a) => a.speedRatio);
    const launchDeltaDeg = launchDeltaAt(index, anchors);

    const ballSpeedMph = baseline.ballSpeedMph * speedRatio;
    const launchDeg = baseline.launchDeg + launchDeltaDeg;
    // No spin measurement is taken -- scale it by the same speed ratio as
    // ball speed, matching enrichShot's own spin-estimation assumption
    // elsewhere (spin scales with swing speed) rather than inventing a
    // second, unrelated heuristic here.
    const spinRpm = baseline.spinRpm * speedRatio;

    const isAnchor = anchors.some((a) => a.index === index);
    const note = isAnchor ? "measured anchor" : "interpolated";

    console.log(
      `${baseline.id.padEnd(10)}  ${ballSpeedMph.toFixed(1).padStart(8)}    ${launchDeg.toFixed(2).padStart(8)}    ${spinRpm.toFixed(0).padStart(7)}   ${note}`,
    );

    return { id: baseline.id, name: baseline.name, ballSpeedMph, launchDeg, spinRpm };
  });

  console.log();
  console.log("This is printed for review only -- it does NOT write clubs.ts.");
  console.log("If it looks right, paste these numbers into packages/shot-source/src/clubs.ts by hand.");
  console.log("Then regenerate the golden fixture (packages/physics/tests/fixtures/golden.json) --");
  console.log("its inputs just changed, and that's a deliberate, reviewed regeneration, never automatic.");
  console.log();
  console.log(JSON.stringify(proposed, null, 2));
}

main();
