import type { Hole, ShotResult, Point2 } from "@mulligan/game";
import { findClub, type ClubId, type RawShotEvent, type ShotEvent } from "@mulligan/shot-source";

export interface ShotHistoryEntry {
  clubId: ClubId;
  raw: RawShotEvent;
  shot: ShotEvent;
  result: ShotResult;
}

export type GameStatus = "playing" | "on-green";
export type ShotSourceMode = "simulated" | "manual";

/** Manual-entry sliders — mirrors the fields SimulatedShotSource would otherwise generate. */
export interface ManualEntryValues {
  ballSpeedMph: number;
  launchDeg: number;
  spinRpm: number;
  spinAxisDeg: number;
  startLineDeg: number;
}

export interface GameState {
  hole: Hole;
  ballPos: Point2;
  /** Degrees, relative to "aim straight at the pin" — the slider's value. */
  aimOffsetDeg: number;
  selectedClubId: ClubId;
  sourceMode: ShotSourceMode;
  manualValues: ManualEntryValues;
  shotHistory: ShotHistoryEntry[];
  status: GameStatus;
  pendingShot: ShotHistoryEntry | null;
  skipAnimation: boolean;
}

export type GameAction =
  | { type: "SELECT_CLUB"; clubId: ClubId }
  | { type: "SET_AIM_OFFSET_DEG"; deg: number }
  | { type: "SET_SOURCE_MODE"; mode: ShotSourceMode }
  | { type: "SET_MANUAL_VALUE"; field: keyof ManualEntryValues; value: number }
  | { type: "SWING_RESOLVED"; entry: ShotHistoryEntry }
  | { type: "SHOT_SETTLED" }
  | { type: "TOGGLE_SKIP_ANIMATION" }
  | { type: "RESET"; hole: Hole; clubId: ClubId };

function manualValuesForClub(clubId: ClubId): ManualEntryValues {
  const club = findClub(clubId);
  return { ballSpeedMph: club.ballSpeedMph, launchDeg: club.launchDeg, spinRpm: club.spinRpm, spinAxisDeg: 0, startLineDeg: 0 };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "SELECT_CLUB":
      // Loading the new club's preset into the manual sliders too means
      // switching to Manual mode right after picking a club starts from
      // that club's typical numbers, not whatever was left over.
      return { ...state, selectedClubId: action.clubId, manualValues: manualValuesForClub(action.clubId) };
    case "SET_AIM_OFFSET_DEG":
      return { ...state, aimOffsetDeg: action.deg };
    case "SET_SOURCE_MODE":
      return { ...state, sourceMode: action.mode };
    case "SET_MANUAL_VALUE":
      return { ...state, manualValues: { ...state.manualValues, [action.field]: action.value } };
    case "SWING_RESOLVED":
      return { ...state, pendingShot: action.entry };
    case "SHOT_SETTLED": {
      const entry = state.pendingShot;
      if (!entry) return state;
      return {
        ...state,
        ballPos: entry.result.rest,
        shotHistory: [...state.shotHistory, entry],
        pendingShot: null,
        status: entry.result.restSurface === "green" ? "on-green" : state.status,
      };
    }
    case "TOGGLE_SKIP_ANIMATION":
      return { ...state, skipAnimation: !state.skipAnimation };
    case "RESET":
      return createInitialState(action.hole, action.clubId);
    default:
      return state;
  }
}

export function createInitialState(hole: Hole, initialClubId: ClubId): GameState {
  return {
    hole,
    ballPos: hole.tee,
    aimOffsetDeg: 0,
    selectedClubId: initialClubId,
    sourceMode: "simulated",
    manualValues: manualValuesForClub(initialClubId),
    shotHistory: [],
    status: "playing",
    pendingShot: null,
    skipAnimation: false,
  };
}
