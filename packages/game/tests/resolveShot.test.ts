import { degToRad } from "@mulligan/physics";
import { enrichShot, findClub, type RawShotEvent, type ShotEvent } from "@mulligan/shot-source";
import { describe, expect, it } from "vitest";
import { estimateRollout } from "../src/resolver/rollout";
import { resolveShot } from "../src/resolver/resolveShot";
import type { Hole, Point2 } from "../src/types";

const SIMPLE_HOLE: Hole = {
  id: "test",
  name: "Test hole",
  par: 4,
  tee: { x: 0, y: 0 },
  pin: { x: 0, y: 400 },
  surfaces: [
    {
      type: "fairway",
      points: [
        { x: -30, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 400 },
        { x: -30, y: 400 },
      ],
    },
    {
      type: "green",
      points: [
        { x: -15, y: 390 },
        { x: 15, y: 390 },
        { x: 15, y: 420 },
        { x: -15, y: 420 },
      ],
    },
  ],
  bounds: { minX: -100, maxX: 100, minY: -20, maxY: 450 },
};

function shotFor(clubId: Parameters<typeof findClub>[0], overrides: Partial<RawShotEvent> = {}) {
  const club = findClub(clubId);
  const raw: RawShotEvent = { ballSpeedMph: club.ballSpeedMph, launchDeg: club.launchDeg, timestamp: 1, ...overrides };
  return enrichShot(raw, clubId);
}

/** A custom, non-club shot for tests that need specific launch conditions (e.g. a big rollout). */
function customShot(overrides: Partial<ShotEvent>): ShotEvent {
  return {
    ballSpeedMph: 150,
    launchDeg: 12.5,
    spinRpm: 2800,
    spinAxisDeg: 0,
    startLineDeg: 0,
    clubId: "driver",
    timestamp: 1,
    provenance: {
      ballSpeed: "measured",
      launch: "measured",
      spin: "measured",
      spinAxis: "measured",
      startLine: "measured",
    },
    ...overrides,
  };
}

/** A hole that's fairway everywhere within a generous span -- for finding out where a shot actually lands/rests. */
function fairwayEverywhereHole(): Hole {
  return {
    id: "probe",
    name: "Probe (fairway everywhere)",
    par: 4,
    tee: { x: 0, y: 0 },
    pin: { x: 0, y: 1000 },
    surfaces: [
      {
        type: "fairway",
        points: [
          { x: -100, y: -50 },
          { x: 100, y: -50 },
          { x: 100, y: 1000 },
          { x: -100, y: 1000 },
        ],
      },
    ],
    bounds: { minX: -200, maxX: 200, minY: -100, maxY: 1100 },
  };
}

/** Fairway up to boundaryY, green from boundaryY onward -- both generously wide/deep. */
function fairwayThenGreenHole(boundaryY: number): Hole {
  return {
    id: "boundary-test",
    name: "Boundary test",
    par: 4,
    tee: { x: 0, y: 0 },
    pin: { x: 0, y: boundaryY + 100 },
    surfaces: [
      {
        type: "fairway",
        points: [
          { x: -100, y: -50 },
          { x: 100, y: -50 },
          { x: 100, y: boundaryY },
          { x: -100, y: boundaryY },
        ],
      },
      {
        type: "green",
        points: [
          { x: -100, y: boundaryY },
          { x: 100, y: boundaryY },
          { x: 100, y: boundaryY + 100 },
          { x: -100, y: boundaryY + 100 },
        ],
      },
    ],
    bounds: { minX: -200, maxX: 200, minY: -100, maxY: boundaryY + 200 },
  };
}

// A low, hot launch minimizes descent angle and maximizes landing speed --
// both increase the M1 rollout placeholder -- giving a large, predictable
// roll (double-digit yards, versus the few yards a normal club produces
// today). Exactly how far it carries depends on AeroParams, which are
// getting calibrated soon -- tests below derive boundaries from this
// shot's actual resolved landing/rest rather than hardcoding a distance.
const BIG_ROLLOUT_SHOT = customShot({ launchDeg: 6, spinRpm: 1200 });

describe("resolveShot", () => {
  it("a straight shot down heading 0 lands directly downrange of the ball", () => {
    const shot = shotFor("7i");
    const result = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, shot);
    expect(result.landing.x).toBeCloseTo(0, 1);
    expect(result.landing.y).toBeCloseTo(result.carryYds, 6);
    expect(result.landingSurface).toBe("fairway");
  });

  it("matches the M0 golden carry for a straight driver shot", () => {
    const shot = shotFor("driver");
    const result = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, shot);
    expect(Math.abs(result.carryYds - 224.44)).toBeLessThanOrEqual(0.1);
  });

  it("total distance is carry plus the M1 rollout placeholder, consistently", () => {
    const shot = shotFor("7i");
    const result = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, shot);
    const expectedRollout = estimateRollout(result.trajectory.landing);
    expect(result.totalYds).toBeCloseTo(result.carryYds + expectedRollout, 6);
    expect(result.rest.y).toBeGreaterThan(result.landing.y); // rolled further downrange
  });

  it("resolves a shot from a non-tee position and a non-zero heading", () => {
    const shot = shotFor("9i");
    const ballPos: Point2 = { x: 10, y: 250 };
    const heading = degToRad(15); // aiming right of the pin
    const result = resolveShot(SIMPLE_HOLE, ballPos, heading, shot);
    // heading > 0 should bend the flight path toward +x relative to a
    // straight-up shot from the same spot.
    const straight = resolveShot(SIMPLE_HOLE, ballPos, 0, shot);
    expect(result.landing.x).toBeGreaterThan(straight.landing.x);
  });

  it("path2d starts at the ball position and its last point matches the landing", () => {
    const shot = shotFor("pw");
    const ballPos: Point2 = { x: 5, y: 100 };
    const result = resolveShot(SIMPLE_HOLE, ballPos, 0, shot);
    expect(result.path2d[0]).toEqual(ballPos);
    const last = result.path2d[result.path2d.length - 1]!;
    expect(last.x).toBeCloseTo(result.landing.x, 6);
    expect(last.y).toBeCloseTo(result.landing.y, 6);
  });

  it("rest can be on a different surface than landing, when rollout carries it across a boundary", () => {
    // The boundary is derived from where this shot actually lands and
    // rests, not hardcoded -- a hardcoded y pinned to today's carry would
    // silently stop testing anything once AeroParams get calibrated and
    // carry distances shift by 10-20 yards. Resolve once against a
    // fairway-everywhere hole to find the real landing/rest, then place the
    // fairway/green boundary exactly halfway between them.
    const probeHole = fairwayEverywhereHole();
    const probe = resolveShot(probeHole, { x: 0, y: 0 }, 0, BIG_ROLLOUT_SHOT);
    expect(probe.landingSurface).toBe("fairway");
    expect(probe.rest.y).toBeGreaterThan(probe.landing.y); // confirms there's an actual rollout to place a boundary inside

    const boundaryY = (probe.landing.y + probe.rest.y) / 2;
    const hole = fairwayThenGreenHole(boundaryY);

    const result = resolveShot(hole, { x: 0, y: 0 }, 0, BIG_ROLLOUT_SHOT);

    expect(result.landingSurface).toBe("fairway");
    expect(result.restSurface).toBe("green");
    expect(result.landingSurface).not.toBe(result.restSurface);
  });

  it("rollout continues in the ball's actual landing direction, not straight along the aim line", () => {
    // A big fade: significant lateral offset (curving right) combined with
    // the large-rollout shot. If rollout incorrectly traveled along the aim
    // line (d only), rest.x would equal landing.x. It must not -- rollout
    // has to continue curving right, same direction the ball was already
    // moving on the ground at landing.
    const fadingBigRollout = customShot({ launchDeg: 6, spinRpm: 1200, spinAxisDeg: 16 });
    const result = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, fadingBigRollout);

    expect(result.landingSurface).not.toBe("out"); // sanity: shot actually landed on the hole
    expect(result.rest.x).toBeGreaterThan(result.landing.x);
  });

  it("a fade (positive spin axis) curves right of a straight shot from the same spot", () => {
    const straight = shotFor("7i");
    const fade = shotFor("7i", { spinAxisDeg: 12 });
    const rStraight = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, straight);
    const rFade = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, fade);
    expect(rFade.landing.x).toBeGreaterThan(rStraight.landing.x);
  });
});
