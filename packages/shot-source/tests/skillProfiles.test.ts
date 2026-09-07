import { describe, expect, it } from "vitest";
import { DEFAULT_DISPERSION } from "../src/dispersion";
import { SKILL_PROFILES, dispersionForSkillProfile, findSkillProfile } from "../src/skillProfiles";

describe("skillProfiles", () => {
  it("regular reproduces DEFAULT_DISPERSION exactly", () => {
    expect(dispersionForSkillProfile("regular")).toEqual(DEFAULT_DISPERSION);
  });

  it("beginner widens every spread field, low-handicap tightens every spread field", () => {
    const beginner = dispersionForSkillProfile("beginner");
    const lowHandicap = dispersionForSkillProfile("low-handicap");
    const spreadFields = [
      "strikeQualitySpread",
      "ballSpeedNoiseSigmaPct",
      "launchAngleNoiseSigmaDeg",
      "launchAngleThinFatBiasDeg",
      "spinNoiseSigmaPct",
      "startLineSigmaDeg",
      "spinAxisSigmaDeg",
    ] as const;
    for (const field of spreadFields) {
      expect(beginner[field]).toBeGreaterThan(DEFAULT_DISPERSION[field]);
      expect(lowHandicap[field]).toBeLessThan(DEFAULT_DISPERSION[field]);
    }
  });

  it("never touches average-quality or shape fields", () => {
    for (const profile of SKILL_PROFILES) {
      const d = dispersionForSkillProfile(profile.id);
      expect(d.ballSpeedBaseFactor).toBe(DEFAULT_DISPERSION.ballSpeedBaseFactor);
      expect(d.ballSpeedQualityFactor).toBe(DEFAULT_DISPERSION.ballSpeedQualityFactor);
      expect(d.spinAxisStartLineCorrelation).toBe(DEFAULT_DISPERSION.spinAxisStartLineCorrelation);
    }
  });

  it("findSkillProfile falls back to regular for an unknown id", () => {
    // @ts-expect-error deliberately invalid id, exercising the fallback
    expect(findSkillProfile("not-a-real-profile").id).toBe("regular");
  });
});
