import {
  DEFAULT_AERO,
  degToRad,
  makeAeroModel,
  metersToFeet,
  metersToYards,
  mphToMps,
  radToDeg,
  rpmToRadPerSec,
  simulate,
  type AeroParams,
} from "@mulligan/physics";
import { describe, expect, it } from "vitest";
import { CLUBS } from "../src/clubs";
import { computeResiduals, fitAeroParams } from "../src/calibration/fit";
import type { Measurement } from "../src/calibration/measurements";

// A deliberately "wrong" ground truth, applied on top of DEFAULT_AERO, used
// only to generate synthetic range data — never asserted as a real value.
const TRUE_AERO: AeroParams = {
  ...DEFAULT_AERO,
  dragBase: DEFAULT_AERO.dragBase * 0.85,
  dragSlope: DEFAULT_AERO.dragSlope * 1.15,
  liftCoeff: DEFAULT_AERO.liftCoeff * 1.2,
};

function syntheticMeasurements(params: AeroParams): Measurement[] {
  const aero = makeAeroModel(params);
  return CLUBS.map((club) => {
    const trajectory = simulate(
      {
        ballSpeed: mphToMps(club.ballSpeedMph),
        launchAngle: degToRad(club.launchDeg),
        spinRate: rpmToRadPerSec(club.spinRpm),
        spinAxis: 0,
        startLine: 0,
      },
      { aero },
    );
    return {
      clubId: club.id,
      ballSpeedMph: club.ballSpeedMph,
      launchDeg: club.launchDeg,
      spinRpm: club.spinRpm,
      carryYds: metersToYards(trajectory.carry),
      apexFt: metersToFeet(trajectory.apex),
      descentDeg: radToDeg(trajectory.landing.descentAngle),
      source: "synthetic",
    } satisfies Measurement;
  });
}

describe("fitAeroParams", () => {
  it("returns the seed with zero error when there are no measurements yet", () => {
    const result = fitAeroParams([]);
    expect(result.params).toEqual(DEFAULT_AERO);
    expect(result.residuals.totalWeightedError).toBe(0);
    expect(result.converged).toBe(true);
  });

  it("recovers known perturbed aero parameters from synthetic range data", () => {
    const measurements = syntheticMeasurements(TRUE_AERO);

    const before = computeResiduals(measurements, DEFAULT_AERO);
    const { params: fitted, residuals: after, converged } = fitAeroParams(measurements, DEFAULT_AERO);

    // The fit should collapse the error the seed (DEFAULT_AERO, deliberately
    // wrong) had against this data almost entirely.
    expect(after.totalWeightedError).toBeLessThan(before.totalWeightedError * 0.01);
    expect(after.totalWeightedError).toBeLessThan(1e-4);
    expect(converged).toBe(true);

    // The three parameters we actually perturbed should be recovered to
    // within a few percent. (The other five were left at their true/default
    // value and are less tightly identified by carry/apex/descent alone —
    // this test only makes the "few percent" claim for the ones that matter.)
    for (const key of ["dragBase", "dragSlope", "liftCoeff"] as const) {
      const relativeError = Math.abs(fitted[key] - TRUE_AERO[key]) / TRUE_AERO[key];
      expect(relativeError).toBeLessThan(0.05);
    }
  });
});
