import { describe, expect, it } from "vitest";
import {
  DEFAULT_AERO,
  computeSpinAxis,
  degToRad,
  magnusKinematics,
  mphToMps,
  rpmToRadPerSec,
  simulate,
  type LaunchConditions,
} from "../src/index";

function baseLaunch(overrides: Partial<LaunchConditions> = {}): LaunchConditions {
  return {
    ballSpeed: mphToMps(106),
    launchAngle: degToRad(18.5),
    spinRate: rpmToRadPerSec(7100),
    spinAxis: 0,
    startLine: 0,
    ...overrides,
  };
}

describe("invariants that must hold for any input", () => {
  it("carry increases monotonically with ball speed, launch and spin fixed", () => {
    const speedsMph = [60, 80, 100, 120, 150, 180];
    const carries = speedsMph.map(
      (mph) => simulate(baseLaunch({ ballSpeed: mphToMps(mph) })).carry,
    );
    for (let i = 1; i < carries.length; i++) {
      expect(carries[i]!).toBeGreaterThan(carries[i - 1]!);
    }
  });

  it("zero spin axis and zero start line fly dead straight", () => {
    const trajectory = simulate(baseLaunch());
    expect(Math.abs(trajectory.lateral)).toBeLessThan(0.01);
  });

  it("spin axis sign controls curve direction, symmetric in magnitude", () => {
    const fade = simulate(baseLaunch({ spinAxis: degToRad(10) }));
    const draw = simulate(baseLaunch({ spinAxis: degToRad(-10) }));
    expect(fade.lateral).toBeGreaterThan(0);
    expect(draw.lateral).toBeLessThan(0);
    const ratio = Math.abs(fade.lateral) / Math.abs(draw.lateral);
    expect(ratio).toBeGreaterThan(0.99);
    expect(ratio).toBeLessThan(1.01);
  });

  it("positive start line produces positive lateral landing position", () => {
    const trajectory = simulate(baseLaunch({ startLine: degToRad(6) }));
    expect(trajectory.lateral).toBeGreaterThan(0);
  });

  it("apex exceeds every recorded point's height and occurs strictly mid-flight", () => {
    const trajectory = simulate(baseLaunch());
    for (const point of trajectory.points) {
      expect(point.y).toBeLessThanOrEqual(trajectory.apex + 1e-9);
    }
    const apexPoint = trajectory.points.reduce((max, point) => (point.y > max.y ? point : max));
    expect(apexPoint.t).toBeGreaterThan(0);
    expect(apexPoint.t).toBeLessThan(trajectory.flightTime);
  });

  it("lands exactly at y = 0", () => {
    const trajectory = simulate(baseLaunch());
    expect(trajectory.landing.position.y).toBe(0);
  });

  it("points start at the origin with t = 0 and t is strictly increasing", () => {
    const trajectory = simulate(baseLaunch());
    const first = trajectory.points[0]!;
    expect(first.x).toBe(0);
    expect(first.y).toBe(0); // launchHeight defaults to 0
    expect(first.z).toBe(0);
    expect(first.t).toBe(0);
    for (let i = 1; i < trajectory.points.length; i++) {
      expect(trajectory.points[i]!.t).toBeGreaterThan(trajectory.points[i - 1]!.t);
    }
  });

  it("spin decays exponentially and is lower at landing than at launch", () => {
    const spinRate0 = rpmToRadPerSec(7100);
    const trajectory = simulate(baseLaunch({ spinRate: spinRate0 }));
    expect(trajectory.landing.spinRate).toBeLessThan(spinRate0);
    const expected = spinRate0 * Math.exp(-DEFAULT_AERO.spinDecayRate * trajectory.flightTime);
    const relativeError = Math.abs(trajectory.landing.spinRate - expected) / expected;
    expect(relativeError).toBeLessThan(0.001);
  });

  it("descent angle is strictly positive for every club-like input", () => {
    const speedsMph = [66, 86, 106, 132, 150];
    for (const mph of speedsMph) {
      const trajectory = simulate(baseLaunch({ ballSpeed: mphToMps(mph) }));
      expect(trajectory.landing.descentAngle).toBeGreaterThan(0);
    }
  });

  it("produces no NaN or Infinity across the full documented input range", () => {
    const speedsMph = [40, 80, 120, 160, 200];
    const launchDegs = [4, 15, 30, 45];
    const spinRpms = [1000, 4000, 7000, 11000];
    const axisDegs = [-20, 0, 20];
    const startLineDegs = [-10, 0, 10];

    for (const speedMph of speedsMph) {
      for (const launchDeg of launchDegs) {
        for (const spinRpm of spinRpms) {
          for (const axisDeg of axisDegs) {
            for (const startLineDeg of startLineDegs) {
              const trajectory = simulate({
                ballSpeed: mphToMps(speedMph),
                launchAngle: degToRad(launchDeg),
                spinRate: rpmToRadPerSec(spinRpm),
                spinAxis: degToRad(axisDeg),
                startLine: degToRad(startLineDeg),
              });
              const fields = [
                trajectory.carry,
                trajectory.lateral,
                trajectory.apex,
                trajectory.flightTime,
                trajectory.landing.speed,
                trajectory.landing.descentAngle,
                trajectory.landing.spinRate,
              ];
              for (const field of fields) {
                expect(Number.isFinite(field)).toBe(true);
              }
            }
          }
        }
      }
    }
  });
});

describe("Magnus kinematics helpers (support the sinTheta lift correction)", () => {
  it("spin axis stays perpendicular to launch velocity for a straight shot (sinTheta ~= 1)", () => {
    const launch = baseLaunch();
    const axis = computeSpinAxis(launch.spinAxis, launch.startLine);
    const velocity = {
      x: launch.ballSpeed * Math.cos(launch.launchAngle) * Math.cos(launch.startLine),
      y: launch.ballSpeed * Math.sin(launch.launchAngle),
      z: launch.ballSpeed * Math.cos(launch.launchAngle) * Math.sin(launch.startLine),
    };
    const { sinTheta } = magnusKinematics(axis, velocity);
    expect(sinTheta).toBeGreaterThan(0.999);
    expect(sinTheta).toBeLessThanOrEqual(1.0000001);
  });

  it("axis is always unit length, for any spin axis / start line combination", () => {
    for (const spinAxisDeg of [-20, -8, 0, 8, 20]) {
      for (const startLineDeg of [-10, -6, 0, 6, 10]) {
        const axis = computeSpinAxis(degToRad(spinAxisDeg), degToRad(startLineDeg));
        expect(Math.hypot(axis.x, axis.y, axis.z)).toBeCloseTo(1, 10);
      }
    }
  });

  it("axis is exactly perpendicular to launch velocity when spin axis tilt is zero, for any start line", () => {
    // The launch-frame fix guarantees this for T=0 regardless of Aim — this is
    // exactly the case the corrected side-angle golden values depend on.
    for (const startLineDeg of [-10, -6, 0, 6, 10]) {
      const startLine = degToRad(startLineDeg);
      const axis = computeSpinAxis(0, startLine);
      const velocity = {
        x: mphToMps(106) * Math.cos(degToRad(18.5)) * Math.cos(startLine),
        y: mphToMps(106) * Math.sin(degToRad(18.5)),
        z: mphToMps(106) * Math.cos(degToRad(18.5)) * Math.sin(startLine),
      };
      const dot = axis.x * velocity.x + axis.y * velocity.y + axis.z * velocity.z;
      expect(Math.abs(dot)).toBeLessThan(1e-9 * Math.hypot(velocity.x, velocity.y, velocity.z));
    }
  });
});
