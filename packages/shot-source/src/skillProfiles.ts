import { DEFAULT_DISPERSION, type DispersionParams } from "./dispersion";

export type SkillProfileId = "beginner" | "regular" | "low-handicap";

export interface SkillProfile {
  id: SkillProfileId;
  name: string;
  description: string;
  /**
   * Multiplies every SPREAD field of DEFAULT_DISPERSION (how much a shot
   * varies) -- deliberately NOT ballSpeedBaseFactor/ballSpeedQualityFactor
   * (average strike quality) or spinAxisStartLineCorrelation (a shape
   * constant, not a spread). A profile changes how consistent the
   * simulated player is, not how hard they swing on average.
   */
  sigmaScale: number;
}

export const SKILL_PROFILES: readonly SkillProfile[] = [
  { id: "beginner", name: "Beginner", description: "Wider dispersion -- mishits and off-line shots are common.", sigmaScale: 2.0 },
  { id: "regular", name: "Regular", description: "The baseline dispersion model (DEFAULT_DISPERSION).", sigmaScale: 1.0 },
  { id: "low-handicap", name: "Low handicap", description: "Tighter dispersion -- consistent strikes, small misses.", sigmaScale: 0.55 },
];

const DEFAULT_SKILL_PROFILE_ID: SkillProfileId = "regular";

export function findSkillProfile(id: SkillProfileId): SkillProfile {
  return SKILL_PROFILES.find((p) => p.id === id) ?? SKILL_PROFILES.find((p) => p.id === DEFAULT_SKILL_PROFILE_ID)!;
}

/**
 * Applies a skill profile to DEFAULT_DISPERSION. This is the ONLY function
 * in the codebase that should ever produce a difficulty-adjusted
 * DispersionParams -- and DispersionParams itself only ever reaches
 * SimulatedShotSource (see its constructor/hit()). ManualShotSource takes
 * exact values typed in by the player; NetworkShotSource only ever emits
 * what a real device measured. Neither has a DispersionParams parameter to
 * pass this into, which is what makes "a real device's numbers are never
 * adjusted by a difficulty setting" true by construction, not by
 * discipline -- there's no code path for it to happen through.
 */
export function dispersionForSkillProfile(id: SkillProfileId): DispersionParams {
  const profile = findSkillProfile(id);
  const s = profile.sigmaScale;
  return {
    ...DEFAULT_DISPERSION,
    strikeQualitySpread: DEFAULT_DISPERSION.strikeQualitySpread * s,
    ballSpeedNoiseSigmaPct: DEFAULT_DISPERSION.ballSpeedNoiseSigmaPct * s,
    launchAngleNoiseSigmaDeg: DEFAULT_DISPERSION.launchAngleNoiseSigmaDeg * s,
    launchAngleThinFatBiasDeg: DEFAULT_DISPERSION.launchAngleThinFatBiasDeg * s,
    spinNoiseSigmaPct: DEFAULT_DISPERSION.spinNoiseSigmaPct * s,
    startLineSigmaDeg: DEFAULT_DISPERSION.startLineSigmaDeg * s,
    spinAxisSigmaDeg: DEFAULT_DISPERSION.spinAxisSigmaDeg * s,
  };
}
