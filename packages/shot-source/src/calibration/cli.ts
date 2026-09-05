import { DEFAULT_AERO } from "@mulligan/physics";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeResiduals, fitAeroParams } from "./fit";
import { DISPERSION_MEASUREMENTS, MEASUREMENTS } from "./measurements";

function fmt(n: number | undefined): string {
  if (n === undefined) return "—".padStart(8);
  return (n >= 0 ? "+" : "") + n.toFixed(2).padStart(7);
}

function main(): void {
  console.log(`Calibration: ${MEASUREMENTS.length} measurement(s), ${DISPERSION_MEASUREMENTS.length} dispersion group(s) loaded.`);

  if (MEASUREMENTS.length === 0) {
    console.log("");
    console.log("Nothing to fit yet — MEASUREMENTS is empty, so this only reports DEFAULT_AERO unchanged.");
    console.log("");
    console.log("Bring back from the range: 3 clubs (driver, 7-iron, a wedge), 5 numbers");
    console.log("per club (ball speed, launch angle, carry, apex, descent angle), ~5-10");
    console.log("shots each. Full checklist: docs/range-session.md.");
    console.log("");
    console.log("Add rows to MEASUREMENTS in src/calibration/measurements.ts (it has a");
    console.log("commented example) and re-run `npm run calibrate`.");
    console.log("");
    console.log("Current DEFAULT_AERO (unchanged):");
    console.log(JSON.stringify(DEFAULT_AERO, null, 2));
    return;
  }

  if (DISPERSION_MEASUREMENTS.length === 0) {
    console.log("");
    console.log("Note: DISPERSION_MEASUREMENTS is still empty -- this run only fits carry/apex/");
    console.log("descent (AeroParams), not shot-to-shot spread. Wedge dispersion at more than");
    console.log("one swing fraction is what @mulligan/shot-source's partialSwingPenalty needs");
    console.log("to stop being a guess -- see the wedge-spread step in docs/range-session.md.");
  }

  const before = computeResiduals(MEASUREMENTS, DEFAULT_AERO);
  const { params, residuals: after, converged } = fitAeroParams(MEASUREMENTS);

  console.log("");
  console.log("Residuals, before (DEFAULT_AERO) -> after (fitted), per measurement:");
  console.log("club        carry err yd            apex err ft            descent err deg");
  for (let i = 0; i < MEASUREMENTS.length; i++) {
    const b = before.perClub[i]!;
    const a = after.perClub[i]!;
    console.log(
      `${b.clubId.padEnd(10)}  ${fmt(b.carryErrorYds)} -> ${fmt(a.carryErrorYds)}   ` +
        `${fmt(b.apexErrorFt)} -> ${fmt(a.apexErrorFt)}   ` +
        `${fmt(b.descentErrorDeg)} -> ${fmt(a.descentErrorDeg)}`,
    );
  }

  console.log("");
  console.log(`Total weighted error: ${before.totalWeightedError.toFixed(4)} -> ${after.totalWeightedError.toFixed(4)}`);
  console.log(`Converged: ${converged}`);

  const outPath = resolve(process.cwd(), "calibration-output.json");
  writeFileSync(outPath, JSON.stringify(params, null, 2) + "\n");
  console.log("");
  console.log(`Fitted params written to ${outPath}`);
  console.log("DEFAULT_AERO was NOT changed — review the fit above and paste these into");
  console.log("packages/physics/src/aero.ts by hand if you accept it.");
}

main();
