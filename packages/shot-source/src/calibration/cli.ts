import { DEFAULT_AERO } from "@mulligan/physics";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeResiduals, fitAeroParams } from "./fit";
import { MEASUREMENTS } from "./measurements";

function fmt(n: number | undefined): string {
  if (n === undefined) return "—".padStart(8);
  return (n >= 0 ? "+" : "") + n.toFixed(2).padStart(7);
}

function main(): void {
  console.log(`Calibration: ${MEASUREMENTS.length} measurement(s) loaded from calibration/measurements.ts.`);

  if (MEASUREMENTS.length === 0) {
    console.log("");
    console.log("No measurements yet — nothing to fit.");
    console.log("Add real range data to MEASUREMENTS (see src/calibration/measurements.ts)");
    console.log("and re-run `npm run calibrate`.");
    console.log("");
    console.log("Current DEFAULT_AERO (unchanged):");
    console.log(JSON.stringify(DEFAULT_AERO, null, 2));
    return;
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
