import type { Hole, ShotResult, Point2 } from "@mulligan/game";
import type { ClubId, RawShotEvent, ShotEvent } from "@mulligan/shot-source";

export interface ShotHistoryEntry {
  clubId: ClubId;
  raw: RawShotEvent;
  shot: ShotEvent;
  result: ShotResult;
}

export type GameStatus = "playing" | "on-green";

export interface GameState {
  hole: Hole;
  ballPos: Point2;
  /** Degrees, relative to "aim straight at the pin" — the slider's value. */
  aimOffsetDeg: number;
  selectedClubId: ClubId;
  shotHistory: ShotHistoryEntry[];
  status: GameStatus;
  pendingShot: ShotHistoryEntry | null;
  skipAnimation: boolean;
}

export type GameAction =
  | { type: "SELECT_CLUB"; clubId: ClubId }
  | { type: "SET_AIM_OFFSET_DEG"; deg: number }
  | { type: "SWING_RESOLVED"; entry: ShotHistoryEntry }
  | { type: "SHOT_SETTLED" }
  | { type: "TOGGLE_SKIP_ANIMATION" }
  | { type: "RESET"; hole: Hole; clubId: ClubId };

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "SELECT_CLUB":
      return { ...state, selectedClubId: action.clubId };
    case "SET_AIM_OFFSET_DEG":
      return { ...state, aimOffsetDeg: action.deg };
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
    shotHistory: [],
    status: "playing",
    pendingShot: null,
    skipAnimation: false,
  };
}
