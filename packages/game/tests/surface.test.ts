import { describe, expect, it } from "vitest";
import { pointInPolygon, surfaceAt } from "../src/surface";
import type { Hole } from "../src/types";

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("is true for a point well inside the polygon", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it("is false for a point well outside the polygon", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: -5, y: 5 }, square)).toBe(false);
  });

  it("handles a non-convex (dogleg-shaped) polygon", () => {
    // An L: the bounding box [0,20]x[0,20] with the bottom-right quadrant
    // (x:[10,20], y:[0,10]) notched out.
    const dogleg = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(pointInPolygon({ x: 5, y: 15 }, dogleg)).toBe(true); // left column
    expect(pointInPolygon({ x: 15, y: 15 }, dogleg)).toBe(true); // top-right quadrant
    expect(pointInPolygon({ x: 15, y: 5 }, dogleg)).toBe(false); // the notched-out quadrant
  });
});

describe("surfaceAt", () => {
  const hole: Hole = {
    id: "test",
    name: "Test hole",
    par: 4,
    tee: { x: 0, y: 0 },
    pin: { x: 0, y: 100 },
    surfaces: [
      {
        type: "fairway",
        points: [
          { x: -20, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 100 },
          { x: -20, y: 100 },
        ],
      },
      {
        type: "bunker",
        points: [
          { x: -5, y: 45 },
          { x: 5, y: 45 },
          { x: 5, y: 55 },
          { x: -5, y: 55 },
        ],
      },
    ],
    bounds: { minX: -30, maxX: 30, minY: -10, maxY: 110 },
  };

  it("returns the fairway inside the fairway polygon", () => {
    expect(surfaceAt(hole, { x: 0, y: 20 })).toBe("fairway");
  });

  it("returns the topmost (later-painted) surface where polygons overlap", () => {
    // the bunker sits inside the fairway polygon — it must win.
    expect(surfaceAt(hole, { x: 0, y: 50 })).toBe("bunker");
  });

  it("returns rough for a point inside bounds but in no polygon", () => {
    expect(surfaceAt(hole, { x: -25, y: 20 })).toBe("rough");
  });

  it("returns out for a point outside the hole's bounds", () => {
    expect(surfaceAt(hole, { x: 0, y: 500 })).toBe("out");
    expect(surfaceAt(hole, { x: -1000, y: 20 })).toBe("out");
  });
});

describe("HOLE_1 (the authored dogleg-right par 4)", () => {
  it("has sane basic properties", async () => {
    const { HOLE_1 } = await import("../src/index");
    expect(HOLE_1.par).toBe(4);
    expect(HOLE_1.tee).toEqual({ x: 0, y: 0 });
    // 400-yard hole per spec
    expect(HOLE_1.pin.y).toBeGreaterThan(390);
    expect(HOLE_1.pin.y).toBeLessThan(410);
  });

  it("is not straight — the fairway centerline drifts right with distance", async () => {
    const { HOLE_1, surfaceAt } = await import("../src/index");
    // near the tee, dead center is fairway; the same lateral position far
    // down the hole should have drifted into rough as the corridor moves right.
    expect(surfaceAt(HOLE_1, { x: 0, y: 60 })).toBe("fairway");
    expect(surfaceAt(HOLE_1, { x: 0, y: 300 })).not.toBe("fairway");
    expect(surfaceAt(HOLE_1, { x: 20, y: 300 })).toBe("fairway");
  });

  it("places the fairway bunker on the inside of the dogleg, overlapping the fairway", async () => {
    const { HOLE_1, surfaceAt } = await import("../src/index");
    expect(surfaceAt(HOLE_1, { x: 18, y: 250 })).toBe("bunker");
  });

  it("identifies the green near the pin", async () => {
    const { HOLE_1, surfaceAt } = await import("../src/index");
    expect(surfaceAt(HOLE_1, HOLE_1.pin)).toBe("green");
  });

  it("identifies the tee box at the origin", async () => {
    const { HOLE_1, surfaceAt } = await import("../src/index");
    expect(surfaceAt(HOLE_1, { x: 0, y: 0 })).toBe("tee");
  });
});
