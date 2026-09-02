import { describe, expect, it } from "vitest";
import { degToRad, mphToMps, rpmToRadPerSec, simulate } from "../src/index";

describe("safety guards", () => {
  it("throws a clear error instead of hanging when the ball can't land within maxTime", () => {
    expect(() =>
      simulate(
        {
          ballSpeed: mphToMps(106),
          launchAngle: degToRad(18.5),
          spinRate: rpmToRadPerSec(7100),
          spinAxis: 0,
          startLine: 0,
        },
        { maxTime: 0.001 },
      ),
    ).toThrow(/did not land/);
  });

  it("throws a clear error instead of hanging when the iteration cap is hit", () => {
    expect(() =>
      simulate(
        {
          ballSpeed: mphToMps(106),
          launchAngle: degToRad(18.5),
          spinRate: rpmToRadPerSec(7100),
          spinAxis: 0,
          startLine: 0,
        },
        { maxSteps: 2 },
      ),
    ).toThrow(/iteration count/);
  });

  it("dt is override-able for the calibration harness", () => {
    const trajectory = simulate(
      {
        ballSpeed: mphToMps(106),
        launchAngle: degToRad(18.5),
        spinRate: rpmToRadPerSec(7100),
        spinAxis: 0,
        startLine: 0,
      },
      { dt: 0.001 },
    );
    expect(Number.isFinite(trajectory.carry)).toBe(true);
  });
});
