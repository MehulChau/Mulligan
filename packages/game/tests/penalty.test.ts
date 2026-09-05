import { describe, expect, it } from "vitest";
import { isPenaltySurface, resolvePenalty } from "../src/rules/penalty";
import type { Point2 } from "../src/types";

describe("isPenaltySurface", () => {
  it("flags water and out, nothing else", () => {
    expect(isPenaltySurface("water")).toBe(true);
    expect(isPenaltySurface("out")).toBe(true);
    for (const surface of ["tee", "fairway", "rough", "bunker", "green"] as const) {
      expect(isPenaltySurface(surface)).toBe(false);
    }
  });
});

describe("resolvePenalty", () => {
  it("out of bounds: one stroke, replay from the exact previous position (stroke and distance)", () => {
    const previousPos: Point2 = { x: 5, y: 100 };
    const restPos: Point2 = { x: 40, y: 260 };
    const resolution = resolvePenalty("out", previousPos, restPos);
    expect(resolution.strokePenalty).toBe(1);
    expect(resolution.nextBallPos).toEqual(previousPos);
  });

  it("water: one stroke, drops a couple yards back toward the previous position, not at the entry point", () => {
    const previousPos: Point2 = { x: 0, y: 100 };
    const restPos: Point2 = { x: 0, y: 200 };
    const resolution = resolvePenalty("water", previousPos, restPos);
    expect(resolution.strokePenalty).toBe(1);
    // dropped back along the previous->entry line, so still downrange of
    // the previous shot but short of where the ball actually entered.
    expect(resolution.nextBallPos.y).toBeLessThan(restPos.y);
    expect(resolution.nextBallPos.y).toBeGreaterThan(previousPos.y);
  });

  it("water drop never overshoots back past the previous position", () => {
    const previousPos: Point2 = { x: 0, y: 100 };
    const restPos: Point2 = { x: 0, y: 100.5 }; // entered water just half a yard past the previous shot
    const resolution = resolvePenalty("water", previousPos, restPos);
    expect(resolution.nextBallPos.y).toBeGreaterThanOrEqual(previousPos.y);
    expect(resolution.nextBallPos.y).toBeLessThanOrEqual(restPos.y);
  });

  it("water drop handles previousPos === restPos without producing NaN", () => {
    const pos: Point2 = { x: 3, y: 150 };
    const resolution = resolvePenalty("water", pos, pos);
    expect(Number.isFinite(resolution.nextBallPos.x)).toBe(true);
    expect(Number.isFinite(resolution.nextBallPos.y)).toBe(true);
  });

  it("both penalty kinds produce a playable (finite, on-hole-ish) next position", () => {
    const previousPos: Point2 = { x: 10, y: 50 };
    const restPos: Point2 = { x: -20, y: 400 };
    for (const kind of ["water", "out"] as const) {
      const resolution = resolvePenalty(kind, previousPos, restPos);
      expect(Number.isFinite(resolution.nextBallPos.x)).toBe(true);
      expect(Number.isFinite(resolution.nextBallPos.y)).toBe(true);
    }
  });
});
