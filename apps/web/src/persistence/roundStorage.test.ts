import { COURSE, headingToward, resolveShot } from "@mulligan/game";
import { SimulatedShotSource, enrichShot } from "@mulligan/shot-source";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultBag } from "../bag";
import { createInitialState, gameReducer } from "../game/gameState";
import {
  clearPersistedRoundState,
  hydrateRoundState,
  isValidPersistedRoundState,
  loadPersistedRound,
  saveRoundState,
  serializeRoundState,
} from "./roundStorage";
import { idbSet } from "./idb";

function freshState() {
  return createInitialState(COURSE[0]!, "7i", "ws://localhost:8080", defaultBag());
}

/** A state with at least one real shot in shotHistory -- exercises the shotHistory validator branch, not just the empty-array case. */
function stateWithOneShot() {
  const source = new SimulatedShotSource({ seed: 1, fidelity: "full" });
  source.start();
  const state = freshState();
  const raw = source.hit("7i", Date.now());
  const shot = enrichShot(raw, "7i");
  const result = resolveShot(state.hole, state.ballPos, headingToward(state.ballPos, state.hole.pin), shot);
  const entry = { clubId: "7i" as const, raw, shot, result };
  let next = gameReducer(state, { type: "SWING_RESOLVED", entry });
  next = gameReducer(next, { type: "SHOT_SETTLED" });
  return next;
}

describe("roundStorage: serialize/hydrate round-trip", () => {
  it("a freshly created state round-trips through serialize -> validate -> hydrate", () => {
    const state = freshState();
    const persisted = serializeRoundState(state);
    expect(isValidPersistedRoundState(persisted, COURSE.length)).toBe(true);
    const hydrated = hydrateRoundState(persisted, COURSE, defaultBag());
    expect(hydrated.ballPos).toEqual(state.ballPos);
    expect(hydrated.selectedClubId).toBe(state.selectedClubId);
    expect(hydrated.strokeCount).toBe(state.strokeCount);
    expect(hydrated.phase).toBe(state.phase);
    expect(hydrated.hole.id).toBe(state.hole.id);
  });

  it("a state with a real logged shot round-trips, including shotHistory", () => {
    const state = stateWithOneShot();
    const persisted = serializeRoundState(state);
    expect(isValidPersistedRoundState(persisted, COURSE.length)).toBe(true);
    const hydrated = hydrateRoundState(persisted, COURSE, defaultBag());
    expect(hydrated.shotHistory.length).toBe(1);
    expect(hydrated.shotHistory[0]!.clubId).toBe("7i");
    expect(hydrated.strokeCount).toBe(1);
  });

  it("hydration always resets transient fields regardless of what was persisted", () => {
    const state = freshState();
    const persisted = serializeRoundState(state);
    const hydrated = hydrateRoundState(persisted, COURSE, defaultBag());
    expect(hydrated.pendingShot).toBeNull();
    expect(hydrated.device.connectionState).toBe("disconnected");
    expect(hydrated.device.calibratingZero).toBe(false);
    expect(hydrated.device.pendingZeroSample).toBeNull();
  });
});

describe("roundStorage: isValidPersistedRoundState fuzzing", () => {
  const validBase = () => serializeRoundState(freshState());

  it("accepts a genuinely valid record", () => {
    expect(isValidPersistedRoundState(validBase(), COURSE.length)).toBe(true);
  });

  const garbageInputs: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["a bare number", 42],
    ["a bare string", "not an object"],
    ["an array", [1, 2, 3]],
    ["an empty object", {}],
    ["a totally unrelated object shape", { foo: "bar", baz: 1 }],
  ];
  for (const [label, input] of garbageInputs) {
    it(`rejects ${label} without throwing`, () => {
      expect(() => isValidPersistedRoundState(input, COURSE.length)).not.toThrow();
      expect(isValidPersistedRoundState(input, COURSE.length)).toBe(false);
    });
  }

  it("rejects a future/unknown schemaVersion", () => {
    const record = { ...validBase(), schemaVersion: 2 };
    expect(isValidPersistedRoundState(record, COURSE.length)).toBe(false);
  });

  it("rejects courseHoleIndex out of range (negative, too large, non-integer, NaN)", () => {
    for (const bad of [-1, COURSE.length, COURSE.length + 100, 1.5, NaN, Infinity]) {
      const record = { ...validBase(), courseHoleIndex: bad };
      expect(isValidPersistedRoundState(record, COURSE.length)).toBe(false);
    }
  });

  it("rejects an unknown selectedClubId", () => {
    const record = { ...validBase(), selectedClubId: "not-a-real-club" };
    expect(isValidPersistedRoundState(record, COURSE.length)).toBe(false);
  });

  it("rejects a non-finite ballPos (NaN, Infinity, missing fields, wrong type)", () => {
    for (const bad of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 0 }, { x: "0", y: "0" }, null, "0,0"]) {
      const record = { ...validBase(), ballPos: bad };
      expect(isValidPersistedRoundState(record, COURSE.length)).toBe(false);
    }
  });

  it("rejects an unrecognized sourceMode/phase/lastPenalty enum value", () => {
    expect(isValidPersistedRoundState({ ...validBase(), sourceMode: "telepathic" }, COURSE.length)).toBe(false);
    expect(isValidPersistedRoundState({ ...validBase(), phase: "mulligan" }, COURSE.length)).toBe(false);
    expect(isValidPersistedRoundState({ ...validBase(), lastPenalty: "lightning strike" }, COURSE.length)).toBe(false);
  });

  it("rejects a truncated record missing required top-level fields", () => {
    const full = validBase() as unknown as Record<string, unknown>;
    for (const key of Object.keys(full)) {
      const truncated = { ...full };
      delete truncated[key];
      expect(isValidPersistedRoundState(truncated, COURSE.length)).toBe(false);
    }
  });

  it("rejects a shotHistory containing a malformed entry (missing result, non-array path2d, non-finite rest)", () => {
    const base = stateWithOneShot();
    const persisted = serializeRoundState(base);
    const malformedVariants: unknown[] = [
      [{ ...persisted.shotHistory[0], result: undefined }],
      [{ ...persisted.shotHistory[0], result: { ...persisted.shotHistory[0]!.result, path2d: "not-an-array" } }],
      [{ ...persisted.shotHistory[0], result: { ...persisted.shotHistory[0]!.result, rest: { x: NaN, y: 0 } } }],
      [{ clubId: "7i" }], // missing raw/shot/result entirely
      ["just a string, not an object at all"],
    ];
    for (const shotHistory of malformedVariants) {
      const record = { ...persisted, shotHistory };
      expect(() => isValidPersistedRoundState(record, COURSE.length)).not.toThrow();
      expect(isValidPersistedRoundState(record, COURSE.length)).toBe(false);
    }
  });

  it("rejects a non-boolean/non-finite device sub-record", () => {
    const record = { ...validBase(), device: { address: "ws://x", sessionZeroDeg: "not a number", zeroConfirmed: true } };
    expect(isValidPersistedRoundState(record, COURSE.length)).toBe(false);
  });
});

describe("roundStorage: IndexedDB round-trip and corruption handling", () => {
  beforeEach(async () => {
    await clearPersistedRoundState();
  });

  it("save then load returns the same data", async () => {
    const state = stateWithOneShot();
    await saveRoundState(state);
    const loaded = await loadPersistedRound(COURSE);
    expect(loaded).not.toBeNull();
    expect(loaded!.strokeCount).toBe(state.strokeCount);
    expect(loaded!.shotHistory.length).toBe(1);
  });

  it("loadPersistedRound returns null (never throws) when nothing was ever saved", async () => {
    await expect(loadPersistedRound(COURSE)).resolves.toBeNull();
  });

  it("loadPersistedRound returns null for a corrupted raw record written directly (bypassing serializeRoundState)", async () => {
    await idbSet("round", "current", { garbage: true, schemaVersion: 1, courseHoleIndex: "not-a-number" });
    await expect(loadPersistedRound(COURSE)).resolves.toBeNull();
  });

  it("loadPersistedRound returns null for a version-skewed record (schemaVersion from an imagined future release)", async () => {
    const state = stateWithOneShot();
    const persisted = { ...serializeRoundState(state), schemaVersion: 99 as unknown as 1 };
    await idbSet("round", "current", persisted);
    await expect(loadPersistedRound(COURSE)).resolves.toBeNull();
  });

  it("clearPersistedRoundState leaves loadPersistedRound returning null afterward", async () => {
    await saveRoundState(stateWithOneShot());
    await clearPersistedRoundState();
    await expect(loadPersistedRound(COURSE)).resolves.toBeNull();
  });
});
