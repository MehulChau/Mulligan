import { describe, expect, it } from "vitest";
import { defaultBag } from "../bag";
import { buildEverythingExport, everythingExportToJSON, parseEverythingImport } from "./exportEverything";

function validBundleJSON(): string {
  const bundle = buildEverythingExport([], [], defaultBag(), { handedness: "right", unit: "imperial", skillProfileId: "regular" });
  return everythingExportToJSON(bundle);
}

describe("exportEverything: round-trip", () => {
  it("a freshly built bundle parses back successfully", () => {
    const parsed = parseEverythingImport(validBundleJSON());
    expect(parsed).not.toBeNull();
    expect(parsed!.bag.length).toBe(defaultBag().length);
    expect(parsed!.preferences.unit).toBe("imperial");
  });
});

describe("exportEverything: parseEverythingImport fuzzing", () => {
  const malformedText: [string, string][] = [
    ["not JSON at all", "this is not json {{{"],
    ["a JSON array instead of an object", "[1,2,3]"],
    ["a bare JSON number", "42"],
    ["a bare JSON string", '"hello"'],
    ["an empty object", "{}"],
    ["valid JSON, wrong schemaVersion", JSON.stringify({ schemaVersion: 2, shotLog: [], holeCompletions: [], bag: [], preferences: {} })],
    ["shotLog present but not an array", JSON.stringify({ schemaVersion: 1, shotLog: "oops", holeCompletions: [], bag: [], preferences: {} })],
    [
      "holeCompletions present but not an array",
      JSON.stringify({ schemaVersion: 1, shotLog: [], holeCompletions: {}, bag: [], preferences: {} }),
    ],
    ["bag with an unknown clubId", JSON.stringify({ schemaVersion: 1, shotLog: [], holeCompletions: [], bag: [{ clubId: "putter-9000", enabled: true, carryAdjustPct: 0 }], preferences: {} })],
    [
      "bag entry with a non-finite carryAdjustPct",
      JSON.stringify({
        schemaVersion: 1,
        shotLog: [],
        holeCompletions: [],
        bag: [{ clubId: "driver", enabled: true, carryAdjustPct: "NaN" }],
        preferences: {},
      }),
    ],
    [
      "preferences with an invalid unit",
      JSON.stringify({
        schemaVersion: 1,
        shotLog: [],
        holeCompletions: [],
        bag: defaultBag(),
        preferences: { handedness: "right", unit: "furlongs", skillProfileId: "regular" },
      }),
    ],
    [
      "preferences with an unknown skillProfileId",
      JSON.stringify({
        schemaVersion: 1,
        shotLog: [],
        holeCompletions: [],
        bag: defaultBag(),
        preferences: { handedness: "right", unit: "imperial", skillProfileId: "tour-pro" },
      }),
    ],
    ["preferences missing entirely", JSON.stringify({ schemaVersion: 1, shotLog: [], holeCompletions: [], bag: defaultBag() })],
    ["truncated mid-file (a real save-interrupted-mid-write scenario)", validBundleJSONTruncated()],
  ];

  for (const [label, text] of malformedText) {
    it(`rejects ${label} without throwing`, () => {
      expect(() => parseEverythingImport(text)).not.toThrow();
      expect(parseEverythingImport(text)).toBeNull();
    });
  }
});

function validBundleJSONTruncated(): string {
  const full = validBundleJSON();
  return full.slice(0, Math.floor(full.length / 2));
}
