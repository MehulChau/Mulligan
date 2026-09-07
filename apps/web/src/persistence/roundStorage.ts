import { CLUBS, type ClubId } from "@mulligan/shot-source";
import type { Hole, PenaltyKind, PuttResult, Point2 } from "@mulligan/game";
import { idbDelete, idbGet, idbSet } from "./idb";
import type { DeviceSessionState, GamePhase, GameState, ManualEntryValues, ShotHistoryEntry, ShotSourceMode } from "../game/gameState";
import { createInitialState } from "../game/gameState";
import type { BagEntry } from "../bag";

const STORE = "round";
const KEY = "current";
const SCHEMA_VERSION = 1;

/**
 * What actually gets written to IndexedDB. Deliberately NOT all of
 * GameState:
 * - `hole` is re-derived from `courseHoleIndex` against the current
 *   COURSE at load time, not stored -- a hole's authored data (bounds,
 *   surfaces, par) can change between sessions, and re-deriving means a
 *   resumed round always plays against today's hole, not a stale copy.
 * - `pendingShot` (mid-flight-animation state) makes no sense across a
 *   reload -- the canvas that was animating it is gone. Always resumes as
 *   settled (null).
 * - The device connection itself (connectionState/deviceInfo/status) and
 *   any in-progress aim-zero calibration are transient by nature -- a
 *   WebSocket can't survive a reload, and resuming mid-calibration would
 *   leave the player stuck in a mode with no visible way back in. The
 *   *result* of a confirmed zero (sessionZeroDeg/zeroConfirmed) and the
 *   address to reconnect to DO persist -- re-zeroing every reload would be
 *   exactly the friction M3's aim-zero design existed to remove.
 */
export interface PersistedRoundStateV1 {
  schemaVersion: 1;
  courseHoleIndex: number;
  roundScores: Partial<Record<string, number>>;
  ballPos: Point2;
  aimOffsetDeg: number;
  selectedClubId: ClubId;
  sourceMode: ShotSourceMode;
  swingFraction: number;
  manualValues: ManualEntryValues;
  shotHistory: ShotHistoryEntry[];
  skipAnimation: boolean;
  phase: GamePhase;
  strokeCount: number;
  strokesToGreen: number | null;
  puttDistanceYds: number;
  puttAttempts: number;
  lastPuttResult: PuttResult | null;
  lastPenalty: PenaltyKind | null;
  device: {
    address: string;
    sessionZeroDeg: number;
    zeroConfirmed: boolean;
  };
  /** epoch ms -- lets the resume prompt say something more useful than "a round exists." */
  savedAt: number;
}

export function serializeRoundState(state: GameState): PersistedRoundStateV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    courseHoleIndex: state.courseHoleIndex,
    roundScores: state.roundScores,
    ballPos: state.ballPos,
    aimOffsetDeg: state.aimOffsetDeg,
    selectedClubId: state.selectedClubId,
    sourceMode: state.sourceMode,
    swingFraction: state.swingFraction,
    manualValues: state.manualValues,
    shotHistory: state.shotHistory,
    skipAnimation: state.skipAnimation,
    phase: state.phase,
    strokeCount: state.strokeCount,
    strokesToGreen: state.strokesToGreen,
    puttDistanceYds: state.puttDistanceYds,
    puttAttempts: state.puttAttempts,
    lastPuttResult: state.lastPuttResult,
    lastPenalty: state.lastPenalty,
    device: {
      address: state.device.address,
      sessionZeroDeg: state.device.sessionZeroDeg,
      zeroConfirmed: state.device.zeroConfirmed,
    },
    savedAt: Date.now(),
  };
}

// ---------- validation ----------
// Deliberately real (not exhaustive) checks, not just a type assertion --
// this is what stands between a corrupted or version-skewed IndexedDB
// record and a crash on boot. Every check here is something the app would
// otherwise dereference blindly (state.ballPos.x, entry.result.path2d.map,
// ...). Combined with the try/catch in loadPersistedRound below, anything
// this validator misses still can't crash the app -- it can only, worst
// case, fail to resume a round that should have resumed.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isPoint2(v: unknown): v is Point2 {
  return isPlainObject(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y);
}

const CLUB_IDS: readonly string[] = CLUBS.map((c) => c.id);
const SOURCE_MODES = ["simulated", "manual", "device"];
const PHASES = ["shot", "putting", "holed"];
const PENALTIES = ["water", "out"];

function isClubId(v: unknown): v is ClubId {
  return typeof v === "string" && CLUB_IDS.includes(v);
}

function isManualValues(v: unknown): v is ManualEntryValues {
  return (
    isPlainObject(v) &&
    isFiniteNumber(v.ballSpeedMph) &&
    isFiniteNumber(v.launchDeg) &&
    isFiniteNumber(v.spinRpm) &&
    isFiniteNumber(v.spinAxisDeg) &&
    isFiniteNumber(v.startLineDeg)
  );
}

function isShotHistoryEntry(v: unknown): v is ShotHistoryEntry {
  if (!isPlainObject(v)) return false;
  if (!isClubId(v.clubId)) return false;
  if (!isPlainObject(v.raw) || !isFiniteNumber(v.raw.timestamp) || !isFiniteNumber(v.raw.ballSpeedMph) || !isFiniteNumber(v.raw.launchDeg)) {
    return false;
  }
  if (!isPlainObject(v.shot) || !isFiniteNumber(v.shot.ballSpeedMph) || !isFiniteNumber(v.shot.launchDeg)) return false;
  const r = v.result;
  if (!isPlainObject(r)) return false;
  if (!Array.isArray(r.path2d) || !isPlainObject(r.trajectory)) return false;
  if (!isPoint2(r.rest) || !isPoint2(r.landing)) return false;
  if (typeof r.landingSurface !== "string" || typeof r.restSurface !== "string") return false;
  if (!isFiniteNumber(r.carryYds) || !isFiniteNumber(r.totalYds)) return false;
  return true;
}

function isPuttResultOrNull(v: unknown): v is PuttResult | null {
  if (v === null) return true;
  return isPlainObject(v) && typeof v.holed === "boolean" && isFiniteNumber(v.distanceBefore) && isFiniteNumber(v.distanceAfter);
}

export function isValidPersistedRoundState(v: unknown, courseLength: number): v is PersistedRoundStateV1 {
  if (!isPlainObject(v)) return false;
  if (v.schemaVersion !== SCHEMA_VERSION) return false;
  if (!isFiniteNumber(v.courseHoleIndex) || v.courseHoleIndex < 0 || v.courseHoleIndex >= courseLength) return false;
  if (!isPlainObject(v.roundScores)) return false;
  if (!isPoint2(v.ballPos)) return false;
  if (!isFiniteNumber(v.aimOffsetDeg)) return false;
  if (!isClubId(v.selectedClubId)) return false;
  if (typeof v.sourceMode !== "string" || !SOURCE_MODES.includes(v.sourceMode)) return false;
  if (!isFiniteNumber(v.swingFraction)) return false;
  if (!isManualValues(v.manualValues)) return false;
  if (!Array.isArray(v.shotHistory) || !v.shotHistory.every(isShotHistoryEntry)) return false;
  if (typeof v.skipAnimation !== "boolean") return false;
  if (typeof v.phase !== "string" || !PHASES.includes(v.phase)) return false;
  if (!isFiniteNumber(v.strokeCount) || v.strokeCount < 0) return false;
  if (v.strokesToGreen !== null && !isFiniteNumber(v.strokesToGreen)) return false;
  if (!isFiniteNumber(v.puttDistanceYds)) return false;
  if (!isFiniteNumber(v.puttAttempts) || v.puttAttempts < 0) return false;
  if (!isPuttResultOrNull(v.lastPuttResult)) return false;
  if (v.lastPenalty !== null && (typeof v.lastPenalty !== "string" || !PENALTIES.includes(v.lastPenalty))) return false;
  if (!isPlainObject(v.device) || typeof v.device.address !== "string" || !isFiniteNumber(v.device.sessionZeroDeg) || typeof v.device.zeroConfirmed !== "boolean") {
    return false;
  }
  if (!isFiniteNumber(v.savedAt)) return false;
  return true;
}

/**
 * Rebuilds a full GameState from a validated record -- `hole` comes from
 * `course`, everything transient resets to its normal boot default. `bag`
 * isn't part of the persisted record at all (it's a localStorage player
 * preference, same footing as handedness/units -- see bag.ts) and is
 * passed in fresh from whatever the player's current bag setting is, not
 * whatever it was when the round was saved.
 */
export function hydrateRoundState(persisted: PersistedRoundStateV1, course: readonly Hole[], bag: BagEntry[]): GameState {
  const hole = course[persisted.courseHoleIndex]!;
  const base = createInitialState(hole, persisted.selectedClubId, persisted.device.address, bag);
  const device: DeviceSessionState = {
    ...base.device,
    address: persisted.device.address,
    sessionZeroDeg: persisted.device.sessionZeroDeg,
    zeroConfirmed: persisted.device.zeroConfirmed,
  };
  return {
    ...base,
    courseHoleIndex: persisted.courseHoleIndex,
    roundScores: persisted.roundScores,
    ballPos: persisted.ballPos,
    aimOffsetDeg: persisted.aimOffsetDeg,
    selectedClubId: persisted.selectedClubId,
    sourceMode: persisted.sourceMode,
    swingFraction: persisted.swingFraction,
    manualValues: persisted.manualValues,
    shotHistory: persisted.shotHistory,
    skipAnimation: persisted.skipAnimation,
    pendingShot: null,
    phase: persisted.phase,
    strokeCount: persisted.strokeCount,
    strokesToGreen: persisted.strokesToGreen,
    puttDistanceYds: persisted.puttDistanceYds,
    puttAttempts: persisted.puttAttempts,
    lastPuttResult: persisted.lastPuttResult,
    lastPenalty: persisted.lastPenalty,
    device,
  };
}

export async function saveRoundState(state: GameState): Promise<void> {
  await idbSet(STORE, KEY, serializeRoundState(state));
}

export async function clearPersistedRoundState(): Promise<void> {
  await idbDelete(STORE, KEY);
}

/**
 * Reads and validates the persisted round, if any. Never throws: a
 * corrupted record, a future/unknown schemaVersion, or an IndexedDB error
 * all come back as `null`, indistinguishable from "no round was saved" --
 * the caller's only job on `null` is to start fresh, exactly what would
 * have happened anyway with nothing persisted.
 */
export async function loadPersistedRound(course: readonly Hole[]): Promise<PersistedRoundStateV1 | null> {
  try {
    const raw = await idbGet<unknown>(STORE, KEY);
    if (raw === undefined) return null;
    if (!isValidPersistedRoundState(raw, course.length)) return null;
    return raw;
  } catch {
    return null;
  }
}
