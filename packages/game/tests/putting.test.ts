import { describe, expect, it } from "vitest";
import {
  FRINGE_PUTTING_DISTANCE_YDS,
  MAX_PUTTS,
  isPuttable,
  holeOutPutting,
  makeProbability,
  resolvePutt,
} from "../src/putting/putting";

// A tiny seeded RNG, self-contained -- doesn't need @mulligan/shot-source's
// mulberry32 for these tests, just something deterministic and repeatable.
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("makeProbability", () => {
  it("is monotonically non-increasing as distance grows", () => {
    const distances = [0, 0.1, 1 / 3, 0.5, 1, 1.5, 2, 3, 10 / 3, 5, 20 / 3, 8, 10, 15, 20, 40, 100, 1000];
    for (let i = 1; i < distances.length; i++) {
      expect(makeProbability(distances[i]!)).toBeLessThanOrEqual(makeProbability(distances[i - 1]!));
    }
  });

  it("stays within [0, 1] for zero and absurdly large distances", () => {
    for (const d of [0, -5, 1e6, Number.MAX_SAFE_INTEGER]) {
      const p = makeProbability(d);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("roughly matches the anchor points from the spec", () => {
    expect(makeProbability(1 / 3)).toBeCloseTo(0.99, 2);
    expect(makeProbability(1)).toBeCloseTo(0.9, 2);
    expect(makeProbability(2)).toBeCloseTo(0.65, 2);
    expect(makeProbability(20 / 3)).toBeCloseTo(0.15, 2);
    expect(makeProbability(20)).toBeCloseTo(0.02, 2);
  });
});

describe("resolvePutt", () => {
  it("is immediately holed at distance 0", () => {
    const result = resolvePutt(0, seededRng(1));
    expect(result).toEqual({ holed: true, distanceBefore: 0, distanceAfter: 0 });
  });

  it("a missed putt's leave distance is always less than the putt distance", () => {
    for (const distanceYds of [0.1, 0.5, 1, 2, 5, 10, 20, 40, 80]) {
      for (let seed = 0; seed < 50; seed++) {
        const rng = seededRng(seed * 7919 + 1);
        const result = resolvePutt(distanceYds, rng);
        if (!result.holed) {
          expect(result.distanceAfter).toBeLessThan(distanceYds);
          expect(result.distanceAfter).toBeGreaterThanOrEqual(0);
        } else {
          expect(result.distanceAfter).toBe(0);
        }
      }
    }
  });

  it("is deterministic for the same rng sequence", () => {
    const a = resolvePutt(6, seededRng(42));
    const b = resolvePutt(6, seededRng(42));
    expect(a).toEqual(b);
  });

  it("holes out almost certainly from point-blank range", () => {
    // rng() < probability holes it; probability at ~1 foot is 0.99, so
    // almost any rng stream holes on the first attempt.
    const { strokes, putts } = holeOutPutting(1 / 3, seededRng(3));
    expect(strokes).toBe(1);
    expect(putts[0]!.holed).toBe(true);
  });
});

describe("holeOutPutting", () => {
  it("terminates within MAX_PUTTS for any starting distance, many seeds", () => {
    for (const distanceYds of [1, 5, 15, 30, 60, 150]) {
      for (let seed = 0; seed < 100; seed++) {
        const { putts, strokes } = holeOutPutting(distanceYds, seededRng(seed * 104729 + distanceYds));
        expect(strokes).toBeLessThanOrEqual(MAX_PUTTS);
        expect(putts.length).toBe(strokes);
        // every putt but possibly the last must be a genuine miss with a shorter leave
        for (let i = 0; i < putts.length - 1; i++) {
          expect(putts[i]!.holed).toBe(false);
        }
      }
    }
  });
});

describe("isPuttable", () => {
  it("is always puttable on the green", () => {
    expect(isPuttable("green", 50)).toBe(true);
    expect(isPuttable("green", 0)).toBe(true);
  });

  it("is puttable off the green when close enough to the pin", () => {
    expect(isPuttable("fairway", FRINGE_PUTTING_DISTANCE_YDS)).toBe(true);
    expect(isPuttable("rough", 1)).toBe(true);
  });

  it("is not puttable off the green when far from the pin", () => {
    expect(isPuttable("fairway", FRINGE_PUTTING_DISTANCE_YDS + 0.01)).toBe(false);
    expect(isPuttable("rough", 200)).toBe(false);
  });
});
