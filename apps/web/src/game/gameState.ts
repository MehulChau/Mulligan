import {
  clubAvailability,
  firstAvailableClub,
  isPenaltySurface,
  isPuttable,
  resolvePenalty,
  surfaceAt,
  type Hole,
  type PenaltyKind,
  type PuttResult,
  type ShotResult,
  type Point2,
} from "@mulligan/game";
import { CLUBS, FULL_SWING_FRACTION, findClub, type ClubId, type RawShotEvent, type ShotEvent } from "@mulligan/shot-source";

export interface ShotHistoryEntry {
  clubId: ClubId;
  raw: RawShotEvent;
  shot: ShotEvent;
  result: ShotResult;
}

export type GamePhase = "shot" | "putting" | "holed";
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
  /** How hard a simulated wedge swing is, 0.3-1.0. Only meaningful for a wedge in Simulated mode; reset to full on every club change. */
  swingFraction: number;
  manualValues: ManualEntryValues;
  shotHistory: ShotHistoryEntry[];
  skipAnimation: boolean;
  pendingShot: ShotHistoryEntry | null;

  phase: GamePhase;
  strokeCount: number;
  /** Set once, the moment the ball becomes puttable; used for the final "shots to green / putts" breakdown. */
  strokesToGreen: number | null;
  puttDistanceYds: number;
  puttAttempts: number;
  lastPuttResult: PuttResult | null;
  /** The penalty (if any) incurred by the most recently completed stroke — for the HUD callout. */
  lastPenalty: PenaltyKind | null;
}

export type GameAction =
  | { type: "SELECT_CLUB"; clubId: ClubId }
  | { type: "SET_AIM_OFFSET_DEG"; deg: number }
  | { type: "SET_SOURCE_MODE"; mode: ShotSourceMode }
  | { type: "SET_SWING_FRACTION"; fraction: number }
  | { type: "SET_MANUAL_VALUE"; field: keyof ManualEntryValues; value: number }
  | { type: "SWING_RESOLVED"; entry: ShotHistoryEntry }
  | { type: "SHOT_SETTLED" }
  | { type: "PUTT_RESOLVED"; result: PuttResult }
  | { type: "TOGGLE_SKIP_ANIMATION" }
  | { type: "RESET"; hole: Hole; clubId: ClubId };

/** An amateur golfer picks up after this many putts on one green; nothing loops forever. */
const MAX_PUTTS = 5;

function manualValuesForClub(clubId: ClubId): ManualEntryValues {
  const club = findClub(clubId);
  return { ballSpeedMph: club.ballSpeedMph, launchDeg: club.launchDeg, spinRpm: club.spinRpm, spinAxisDeg: 0, startLineDeg: 0 };
}

function distanceTo(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "SELECT_CLUB":
      // Loading the new club's preset into the manual sliders too means
      // switching to Manual mode right after picking a club starts from
      // that club's typical numbers, not whatever was left over. Swing
      // fraction resets to full for the same reason -- a new club starts
      // from its full-swing carry, not a leftover partial swing from
      // whatever club was selected before.
      return {
        ...state,
        selectedClubId: action.clubId,
        manualValues: manualValuesForClub(action.clubId),
        swingFraction: FULL_SWING_FRACTION,
      };

    case "SET_AIM_OFFSET_DEG":
      return { ...state, aimOffsetDeg: action.deg };

    case "SET_SOURCE_MODE":
      return { ...state, sourceMode: action.mode };

    case "SET_SWING_FRACTION":
      return { ...state, swingFraction: action.fraction };

    case "SET_MANUAL_VALUE":
      return { ...state, manualValues: { ...state.manualValues, [action.field]: action.value } };

    case "SWING_RESOLVED":
      return { ...state, pendingShot: action.entry };

    case "SHOT_SETTLED": {
      const entry = state.pendingShot;
      if (!entry) return state;

      const previousPos = state.ballPos;
      const { rest, restSurface } = entry.result;
      const shotHistory = [...state.shotHistory, entry];
      let strokeCount = state.strokeCount + 1;

      if (isPenaltySurface(restSurface)) {
        const resolution = resolvePenalty(restSurface, previousPos, rest);
        strokeCount += resolution.strokePenalty;
        const ballPos = resolution.nextBallPos;
        const lieAfterDrop = surfaceAt(state.hole, ballPos);
        const selectedClubId = clubAvailability(lieAfterDrop, state.selectedClubId).available
          ? state.selectedClubId
          : firstAvailableClub(lieAfterDrop, CLUBS);

        return {
          ...state,
          ballPos,
          shotHistory,
          pendingShot: null,
          strokeCount,
          selectedClubId,
          lastPenalty: resolution.kind,
        };
      }

      const distanceToPinYds = distanceTo(state.hole.pin, rest);
      if (isPuttable(restSurface, distanceToPinYds)) {
        return {
          ...state,
          ballPos: rest,
          shotHistory,
          pendingShot: null,
          strokeCount,
          phase: "putting",
          strokesToGreen: strokeCount,
          puttDistanceYds: distanceToPinYds,
          puttAttempts: 0,
          lastPenalty: null,
        };
      }

      const selectedClubId = clubAvailability(restSurface, state.selectedClubId).available
        ? state.selectedClubId
        : firstAvailableClub(restSurface, CLUBS);

      return {
        ...state,
        ballPos: rest,
        shotHistory,
        pendingShot: null,
        strokeCount,
        selectedClubId,
        lastPenalty: null,
      };
    }

    case "PUTT_RESOLVED": {
      const strokeCount = state.strokeCount + 1;
      const puttAttempts = state.puttAttempts + 1;
      const finished = action.result.holed || puttAttempts >= MAX_PUTTS;
      return {
        ...state,
        strokeCount,
        puttAttempts,
        puttDistanceYds: action.result.distanceAfter,
        lastPuttResult: action.result,
        phase: finished ? "holed" : "putting",
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
    swingFraction: FULL_SWING_FRACTION,
    manualValues: manualValuesForClub(initialClubId),
    shotHistory: [],
    skipAnimation: false,
    pendingShot: null,

    phase: "shot",
    strokeCount: 0,
    strokesToGreen: null,
    puttDistanceYds: 0,
    puttAttempts: 0,
    lastPuttResult: null,
    lastPenalty: null,
  };
}
