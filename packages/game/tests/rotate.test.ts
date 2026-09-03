import { degToRad } from "@mulligan/physics";
import { describe, expect, it } from "vitest";
import { holeToLocal, localToHole } from "../src/resolver/rotate";
import type { Point2 } from "../src/types";

const TEE: Point2 = { x: 0, y: 0 };

describe("localToHole -- the five sanity checks from the M1 spec", () => {
  it("heading 0, l = 0 puts the ball straight up +y by d", () => {
    const p = localToHole(TEE, 0, { d: 150, l: 0 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(150, 9);
  });

  it("heading 0, l > 0 moves the ball +x (right)", () => {
    const p = localToHole(TEE, 0, { d: 150, l: 10 });
    expect(p.x).toBeCloseTo(10, 9);
  });

  it("heading 90 degrees, l = 0 puts the ball +x by d", () => {
    const p = localToHole(TEE, degToRad(90), { d: 150, l: 0 });
    expect(p.x).toBeCloseTo(150, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it("heading 90 degrees, l > 0 moves the ball -y", () => {
    const p = localToHole(TEE, degToRad(90), { d: 150, l: 10 });
    expect(p.y).toBeCloseTo(-10, 9);
  });

  it("rotating forward then applying the inverse returns the original point", () => {
    // NOTE: negating headingRad in localToHole does NOT invert it -- this
    // transform mixes a rotation with a handedness flip (see rotate.ts), so
    // it is its own inverse at the SAME heading, not at -heading. holeToLocal
    // is the algebraically correct inverse; that is what round-trips here.
    for (const headingDeg of [0, 30, 90, 145, -60, 200]) {
      for (const offset of [
        { d: 150, l: 0 },
        { d: 0, l: 12 },
        { d: 87.5, l: -6.25 },
      ]) {
        const heading = degToRad(headingDeg);
        const holePoint = localToHole(TEE, heading, offset);
        const recovered = holeToLocal(TEE, heading, holePoint);
        expect(recovered.d).toBeCloseTo(offset.d, 9);
        expect(recovered.l).toBeCloseTo(offset.l, 9);
      }
    }
  });

  it("also round-trips from an arbitrary (non-origin) ball position", () => {
    const ballPos: Point2 = { x: 12, y: 220 };
    const heading = degToRad(37);
    const offset = { d: 63.4, l: -8.1 };
    const holePoint = localToHole(ballPos, heading, offset);
    const recovered = holeToLocal(ballPos, heading, holePoint);
    expect(recovered.d).toBeCloseTo(offset.d, 9);
    expect(recovered.l).toBeCloseTo(offset.l, 9);
  });
});
