import {
  DEFAULT_DISPERSION,
  ReplayShotSource,
  ShotLog,
  createMemoryStore,
  enrichShot,
  exportSession,
  findClub,
  importSessionFromJSON,
  loadImportedSessionIntoLog,
  mulberry32,
  sessionExportToJSON,
  simulateShot,
  type ClubId,
  type RawShotEvent,
} from "@mulligan/shot-source";
import { describe, expect, it } from "vitest";
import { headingToward } from "../src/resolver/rotate";
import { resolveShot } from "../src/resolver/resolveShot";
import type { Hole, Point2 } from "../src/types";

const HOLE: Hole = {
  id: "test",
  name: "Test hole",
  par: 4,
  tee: { x: 0, y: 0 },
  pin: { x: 0, y: 400 },
  surfaces: [
    {
      type: "fairway",
      points: [
        { x: -40, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 400 },
        { x: -40, y: 400 },
      ],
    },
    {
      type: "green",
      points: [
        { x: -15, y: 390 },
        { x: 15, y: 390 },
        { x: 15, y: 420 },
        { x: -15, y: 420 },
      ],
    },
  ],
  bounds: { minX: -100, maxX: 100, minY: -20, maxY: 450 },
};

/**
 * Plays a fixed sequence of clubs against HOLE using a seeded
 * SimulatedShotSource-equivalent (simulateShot directly, since this test
 * doesn't need the ShotSource wrapper), logging each stroke exactly as
 * App.tsx does. Returns the ShotLog and the sessionId.
 */
function playLoggedSession(sessionId: string, clubIds: ClubId[]): ShotLog {
  const log = new ShotLog(createMemoryStore());
  const rng = mulberry32(20260904);
  let ballPos: Point2 = HOLE.tee;

  clubIds.forEach((clubId, i) => {
    const club = findClub(clubId);
    const raw: RawShotEvent = simulateShot(club, DEFAULT_DISPERSION, rng, i);
    const shot = enrichShot(raw, clubId);
    const aimHeadingRad = headingToward(ballPos, HOLE.pin);
    const result = resolveShot(HOLE, ballPos, aimHeadingRad, shot);

    log.append({
      sessionId,
      timestamp: raw.timestamp,
      strokeNumber: i + 1,
      isPutt: false,
      penalty: null,
      raw,
      shot,
      rest: result.rest,
      landingSurface: result.landingSurface,
      restSurface: result.restSurface,
    });

    ballPos = result.rest;
  });

  return log;
}

describe("session export/import round-trip", () => {
  it("re-resolving every replayed raw shot in original order reproduces the identical rest position", async () => {
    const sessionId = "round-trip-session";
    const originalLog = playLoggedSession(sessionId, ["driver", "7i", "9i", "pw"]);
    const originalEntries = originalLog.getSession(sessionId);
    expect(originalEntries).toHaveLength(4);

    // Export -> JSON -> import -> a fresh log, exactly as leaving and
    // re-entering the phone would.
    const exported = exportSession(originalLog, sessionId, { note: "test session" });
    const json = sessionExportToJSON(exported);
    const imported = importSessionFromJSON(json);
    const replayLog = loadImportedSessionIntoLog(imported);

    const replay = new ReplayShotSource(replayLog, sessionId);
    await replay.start();

    let ballPos: Point2 = HOLE.tee;
    let replayedCount = 0;

    while (replay.hasNext()) {
      const raw = replay.next()!;
      const original = originalEntries[replayedCount]!;
      const clubId = original.shot!.clubId;

      const shot = enrichShot(raw, clubId);
      const aimHeadingRad = headingToward(ballPos, HOLE.pin);
      const result = resolveShot(HOLE, ballPos, aimHeadingRad, shot);

      expect(result.rest).toEqual(original.rest);
      expect(result.restSurface).toBe(original.restSurface);
      expect(result.landingSurface).toBe(original.landingSurface);

      ballPos = result.rest;
      replayedCount += 1;
    }

    expect(replayedCount).toBe(originalEntries.length);
  });

  it("preserves provenance and every raw field exactly, not just the fields resolveShot happens to use", () => {
    const sessionId = "provenance-check";
    const log = playLoggedSession(sessionId, ["lw"]);
    const imported = importSessionFromJSON(sessionExportToJSON(exportSession(log, sessionId)));

    expect(imported.entries[0]?.raw).toEqual(log.getSession(sessionId)[0]?.raw);
    expect(imported.entries[0]?.shot?.provenance).toEqual(log.getSession(sessionId)[0]?.shot?.provenance);
  });
});
