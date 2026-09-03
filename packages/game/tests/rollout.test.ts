import { degToRad, mphToMps, type LandingState } from "@mulligan/physics";
import { describe, expect, it } from "vitest";
import { estimateRollout } from "../src/resolver/rollout";

function landingState(descentDeg: number, speedMph: number): LandingState {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speed: mphToMps(speedMph),
    descentAngle: degToRad(descentDeg),
    spinRate: 0,
    spinAxis: 0,
  };
}

describe("estimateRollout (M1 placeholder)", () => {
  it("is always non-negative and bounded", () => {
    for (const descentDeg of [10, 30, 44, 60, 85]) {
      for (const speedMph of [10, 40, 80, 150]) {
        const roll = estimateRollout(landingState(descentDeg, speedMph));
        expect(roll).toBeGreaterThanOrEqual(0);
        expect(roll).toBeLessThanOrEqual(35);
      }
    }
  });

  it("a shallower descent produces more roll than a steeper one at the same speed", () => {
    const shallow = estimateRollout(landingState(20, 60));
    const steep = estimateRollout(landingState(50, 60));
    expect(shallow).toBeGreaterThan(steep);
  });

  it("a faster landing speed produces more roll than a slower one at the same descent angle", () => {
    const fast = estimateRollout(landingState(40, 90));
    const slow = estimateRollout(landingState(40, 30));
    expect(fast).toBeGreaterThan(slow);
  });
});
