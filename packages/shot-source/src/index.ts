export { CLUBS, findClub, isWedge, WEDGE_IDS, type ClubId, type ClubProfile } from "./clubs";
export type { RawShotEvent, ShotEvent, ShotField, Provenance } from "./types";
export { enrichShot } from "./enrich";

export type { SwingScalingParams } from "./swing";
export {
  DEFAULT_SWING_SCALING,
  MIN_SWING_FRACTION,
  FULL_SWING_FRACTION,
  clampSwingFraction,
  scaleClubForSwing,
  scaleDispersionForSwing,
} from "./swing";
export type { Measurement } from "./calibration/measurements";
export { MEASUREMENTS } from "./calibration/measurements";
export type { ClubResidual, FitResiduals } from "./calibration/fit";
export { computeResiduals, fitAeroParams } from "./calibration/fit";

export type { DispersionParams } from "./dispersion";
export { DEFAULT_DISPERSION, PERFECT_DISPERSION, sampleStrikeQuality, simulateShot } from "./dispersion";
export { mulberry32, gaussian } from "./rng";

export type { ShotSource } from "./sources/ShotSource";
export { BaseShotSource } from "./sources/ShotSource";
export { ManualShotSource } from "./sources/ManualShotSource";
export type { ShotFidelity, SimulatedShotSourceOptions } from "./sources/SimulatedShotSource";
export { SimulatedShotSource } from "./sources/SimulatedShotSource";
export { ReplayShotSource } from "./sources/ReplayShotSource";

export type { ShotLogEntry, KeyValueStore } from "./log/ShotLog";
export { ShotLog, createMemoryStore } from "./log/ShotLog";
