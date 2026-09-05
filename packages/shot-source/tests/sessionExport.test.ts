import { describe, expect, it } from "vitest";
import { enrichShot } from "../src/enrich";
import { ShotLog, createMemoryStore, type ShotLogEntry } from "../src/log/ShotLog";
import {
  SESSION_EXPORT_FORMAT_VERSION,
  exportSession,
  importSessionFromJSON,
  loadImportedSessionIntoLog,
  sessionExportToJSON,
} from "../src/log/sessionExport";
import type { RawShotEvent } from "../src/types";

function shotEntry(sessionId: string, strokeNumber: number, timestamp: number): ShotLogEntry {
  const raw: RawShotEvent = { ballSpeedMph: 106 + strokeNumber, launchDeg: 18.5, timestamp, startLineDeg: 1.2 };
  return {
    sessionId,
    timestamp,
    strokeNumber,
    isPutt: false,
    penalty: null,
    raw,
    shot: enrichShot(raw, "7i"),
    rest: { x: strokeNumber, y: 150 + strokeNumber },
    landingSurface: "fairway",
    restSurface: "fairway",
  };
}

function puttEntry(sessionId: string, strokeNumber: number, timestamp: number): ShotLogEntry {
  return {
    sessionId,
    timestamp,
    strokeNumber,
    isPutt: true,
    penalty: null,
    puttDistanceBeforeYds: 6,
    puttDistanceAfterYds: 0,
    holed: true,
    puttingSeed: 42,
  };
}

describe("exportSession / sessionExportToJSON", () => {
  it("captures every entry for the session, formatVersion, and caller metadata", () => {
    const log = new ShotLog(createMemoryStore());
    log.append(shotEntry("s1", 1, 1));
    log.append(puttEntry("s1", 2, 2));
    log.append(shotEntry("s2", 1, 1)); // a different session -- must not leak in

    const exported = exportSession(log, "s1", { sessionZeroDeg: 6.4, simulatedSeed: 12345 });

    expect(exported.formatVersion).toBe(SESSION_EXPORT_FORMAT_VERSION);
    expect(exported.sessionId).toBe("s1");
    expect(exported.metadata).toEqual({ sessionZeroDeg: 6.4, simulatedSeed: 12345 });
    expect(exported.entries).toHaveLength(2);
    expect(exported.entries[0]?.raw).toEqual({ ballSpeedMph: 107, launchDeg: 18.5, timestamp: 1, startLineDeg: 1.2 });
    expect(exported.entries[1]?.puttingSeed).toBe(42);
  });

  it("round-trips through JSON without losing or corrupting fields", () => {
    const log = new ShotLog(createMemoryStore());
    log.append(shotEntry("s1", 1, 1));
    const exported = exportSession(log, "s1", { sessionZeroDeg: 3 });

    const json = sessionExportToJSON(exported);
    const reparsed = JSON.parse(json);

    expect(reparsed).toEqual(exported);
  });
});

describe("importSessionFromJSON", () => {
  it("parses a valid export back into the same shape", () => {
    const log = new ShotLog(createMemoryStore());
    log.append(shotEntry("s1", 1, 1));
    log.append(puttEntry("s1", 2, 2));
    const json = sessionExportToJSON(exportSession(log, "s1", { sessionZeroDeg: 6.4 }));

    const imported = importSessionFromJSON(json);
    expect(imported.sessionId).toBe("s1");
    expect(imported.metadata).toEqual({ sessionZeroDeg: 6.4 });
    expect(imported.entries).toHaveLength(2);
  });

  it("throws on malformed JSON", () => {
    expect(() => importSessionFromJSON("{not json")).toThrow(/not valid JSON/);
  });

  it("throws on an unsupported formatVersion", () => {
    const bad = JSON.stringify({ formatVersion: 999, sessionId: "s1", entries: [] });
    expect(() => importSessionFromJSON(bad)).toThrow(/unsupported formatVersion/);
  });

  it("throws when sessionId or entries is missing", () => {
    expect(() => importSessionFromJSON(JSON.stringify({ formatVersion: 1, entries: [] }))).toThrow(/sessionId/);
    expect(() => importSessionFromJSON(JSON.stringify({ formatVersion: 1, sessionId: "s1" }))).toThrow(/entries/);
  });

  it("defaults metadata to an empty object when absent", () => {
    const json = JSON.stringify({ formatVersion: 1, sessionId: "s1", entries: [] });
    expect(importSessionFromJSON(json).metadata).toEqual({});
  });
});

describe("loadImportedSessionIntoLog", () => {
  it("loads every imported entry into a fresh log under the same session id", () => {
    const log = new ShotLog(createMemoryStore());
    log.append(shotEntry("s1", 1, 1));
    log.append(shotEntry("s1", 2, 2));
    const imported = importSessionFromJSON(sessionExportToJSON(exportSession(log, "s1")));

    const replayLog = loadImportedSessionIntoLog(imported);
    expect(replayLog.getSession("s1")).toHaveLength(2);
    expect(replayLog.getSession("s1")[0]?.raw?.ballSpeedMph).toBe(107);
  });

  it("can load into an existing log instead of a fresh one", () => {
    const sourceLog = new ShotLog(createMemoryStore());
    sourceLog.append(shotEntry("s1", 1, 1));
    const imported = importSessionFromJSON(sessionExportToJSON(exportSession(sourceLog, "s1")));

    const targetLog = new ShotLog(createMemoryStore());
    targetLog.append(shotEntry("other", 1, 1));
    loadImportedSessionIntoLog(imported, targetLog);

    expect(targetLog.getSession("s1")).toHaveLength(1);
    expect(targetLog.getSession("other")).toHaveLength(1);
  });
});
