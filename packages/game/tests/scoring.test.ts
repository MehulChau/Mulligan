import { describe, expect, it } from "vitest";
import { scoreToParLabel, summarizeScore } from "../src/rules/scoring";

describe("scoreToParLabel", () => {
  it("names the standard results relative to par", () => {
    const par = 4;
    expect(scoreToParLabel(par - 2, par)).toBe("eagle");
    expect(scoreToParLabel(par - 1, par)).toBe("birdie");
    expect(scoreToParLabel(par, par)).toBe("par");
    expect(scoreToParLabel(par + 1, par)).toBe("bogey");
    expect(scoreToParLabel(par + 2, par)).toBe("double bogey");
  });

  it("falls back to +N beyond double bogey", () => {
    expect(scoreToParLabel(7, 4)).toBe("+3");
    expect(scoreToParLabel(10, 4)).toBe("+6");
  });

  it("handles better than eagle too", () => {
    expect(scoreToParLabel(1, 4)).toBe("albatross");
  });
});

describe("summarizeScore", () => {
  it("adds strokes-to-green and putts into a total, labeled against par", () => {
    const breakdown = summarizeScore(3, 2, 4);
    expect(breakdown.totalStrokes).toBe(5);
    expect(breakdown.label).toBe("bogey");
    expect(breakdown.strokesToGreen).toBe(3);
    expect(breakdown.putts).toBe(2);
    expect(breakdown.par).toBe(4);
  });
});
