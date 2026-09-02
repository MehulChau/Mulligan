import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  degToRad,
  metersToFeet,
  metersToYards,
  mphToMps,
  radToDeg,
  rpmToRadPerSec,
  simulate,
} from "../src/index";

interface GoldenRow {
  club: string;
  ballSpeedMph: number;
  launchDeg: number;
  spinRpm: number;
  carryYds: number;
  apexFt: number;
  hangS: number;
  descentDeg: number;
}

const fixturePath = fileURLToPath(new URL("./fixtures/golden.json", import.meta.url));
const GOLDEN: GoldenRow[] = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("physics golden regression", () => {
  it.each(GOLDEN)(
    "$club reproduces the recorded straight-shot trajectory",
    (row) => {
      const trajectory = simulate({
        ballSpeed: mphToMps(row.ballSpeedMph),
        launchAngle: degToRad(row.launchDeg),
        spinRate: rpmToRadPerSec(row.spinRpm),
        spinAxis: 0,
        startLine: 0,
      });

      const carryYds = metersToYards(trajectory.carry);
      const apexFt = metersToFeet(trajectory.apex);
      const descentDeg = radToDeg(trajectory.landing.descentAngle);

      expect(Math.abs(carryYds - row.carryYds)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(apexFt - row.apexFt)).toBeLessThanOrEqual(1);
      expect(Math.abs(trajectory.flightTime - row.hangS)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(descentDeg - row.descentDeg)).toBeLessThanOrEqual(0.2);
    },
  );
});

describe("spin-axis frame fix — corrected side angles", () => {
  // 7-iron, zero spin axis tilt, varying start line. Pre-fix the old world-frame
  // axis inflated these ~11% (3.0 -> 3.33, 5.0 -> 5.55, 8.0 -> 8.88 degrees).
  const club = GOLDEN.find((row) => row.club === "7i")!;

  it.each([3, 5, 8])("start line %s deg produces a matching side angle, not an inflated one", (startLineDeg) => {
    const trajectory = simulate({
      ballSpeed: mphToMps(club.ballSpeedMph),
      launchAngle: degToRad(club.launchDeg),
      spinRate: rpmToRadPerSec(club.spinRpm),
      spinAxis: 0,
      startLine: degToRad(startLineDeg),
    });

    const sideAngleDeg = radToDeg(Math.atan2(trajectory.lateral, trajectory.carry));
    expect(Math.abs(sideAngleDeg - startLineDeg)).toBeLessThanOrEqual(0.05);
  });
});
