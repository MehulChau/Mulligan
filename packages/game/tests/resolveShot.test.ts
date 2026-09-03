import { degToRad } from "@mulligan/physics";
import { enrichShot, findClub, type RawShotEvent } from "@mulligan/shot-source";
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

  it("reports the surface at rest, which can differ from the surface at landing", () => {
    // land just short of the green (fairway), roll should not normally jump
    // surfaces here, but landingSurface/restSurface are independently computed.
    const shot = shotFor("driver");
    const result = resolveShot(SIMPLE_HOLE, { x: 0, y: 175 }, 0, shot); // lands right around the green
    expect(result.restSurface).toBeDefined();
    expect(result.landingSurface).toBeDefined();
  });

  it("a fade (positive spin axis) curves right of a straight shot from the same spot", () => {
    const straight = shotFor("7i");
    const fade = shotFor("7i", { spinAxisDeg: 12 });
    const rStraight = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, straight);
    const rFade = resolveShot(SIMPLE_HOLE, { x: 0, y: 0 }, 0, fade);
    expect(rFade.landing.x).toBeGreaterThan(rStraight.landing.x);
  });
});
