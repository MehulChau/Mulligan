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
import {
  CLUBS,
  FULL_SWING_FRACTION,
  findClub,
  type ClubId,
  type ConnectionState,
  type DeviceInfo,
  type DeviceStatus,
  type RawShotEvent,
  type ShotEvent,
} from "@mulligan/shot-source";

export interface ShotHistoryEntry {
  clubId: ClubId;
  raw: RawShotEvent;
  shot: ShotEvent;
  result: ShotResult;
}

export type GamePhase = "shot" | "putting" | "holed";
export type ShotSourceMode = "simulated" | "manual" | "device";

/**
 * Everything about the device connection and aim-zeroing that needs to
 * survive a "Play again" (a new hole session, not a new range session) --
 * see docs/device-protocol.md's aim-zeroing section for why this exists at
 * all. Kept as its own sub-object so RESET can carry it forward wholesale
 * instead of re-deriving each field.
 */
export interface DeviceSessionState {
  /** ws:// URL, persisted to localStorage by App.tsx -- not gameState's concern. */
  address: string;
  connectionState: ConnectionState;
  deviceInfo: DeviceInfo | null;
  status: DeviceStatus | null;
  /**
   * Degrees subtracted from every device-reported `startLineDeg` before
   * it's treated as relative to the player's chosen aim line. Deliberately
   * does NOT apply to `spinAxisDeg`: spin axis describes which way the
   * ball curves relative to its OWN initial velocity, which a rotated
   * device mount doesn't change -- only the reported start line (the
   * device's opinion of "which way is straight ahead") needs correcting.
   */
  sessionZeroDeg: number;
  /** Distinguishes "never zeroed, sessionZeroDeg is just its default" from "the player confirmed a zero of exactly 0deg." */
  zeroConfirmed: boolean;
  /** True while the next device shot should be captured as a zero sample instead of played as a stroke. */
  calibratingZero: boolean;
  /** Most recent raw shot captured during calibration, awaiting the player's confirm/cancel. */
  pendingZeroSample: RawShotEvent | null;
}

export const DEFAULT_DEVICE_ADDRESS = "ws://localhost:8080";

function createInitialDeviceState(address: string): DeviceSessionState {
  return {
    address,
    connectionState: "disconnected",
    deviceInfo: null,
    status: null,
    sessionZeroDeg: 0,
    zeroConfirmed: false,
    calibratingZero: false,
    pendingZeroSample: null,
  };
}

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
  /** Index of `hole` within COURSE -- which hole in the sequence this is, for the top bar, the "next hole" flow, and hole-select. */
  courseHoleIndex: number;
  /**
   * Score recorded per hole, keyed by hole id, as each hole is holed out.
   * Deliberately keyed by id rather than a fixed-length array indexed by
   * course position -- replaying a hole from hole-select (practice at the
   * range, hit the same tee shot repeatedly) overwrites that hole's entry
   * rather than needing a "which attempt counts" rule. Survives RESET/
   * GO_TO_HOLE (a new hole or a replay doesn't erase the round so far);
   * only a fresh session (page load) starts it empty.
   */
  roundScores: Partial<Record<string, number>>;
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

  device: DeviceSessionState;
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
  | { type: "RESET"; hole: Hole; clubId: ClubId }
  | { type: "GO_TO_HOLE"; index: number; hole: Hole; clubId: ClubId }
  | { type: "NEW_ROUND"; hole: Hole; clubId: ClubId }
  | { type: "SET_DEVICE_ADDRESS"; address: string }
  | { type: "DEVICE_CONNECTION_STATE"; state: ConnectionState }
  | { type: "DEVICE_INFO"; info: DeviceInfo }
  | { type: "DEVICE_STATUS"; status: DeviceStatus }
  | { type: "START_AIM_ZERO_CALIBRATION" }
  | { type: "AIM_ZERO_SAMPLE_RECEIVED"; raw: RawShotEvent }
  | { type: "CONFIRM_AIM_ZERO" }
  | { type: "CANCEL_AIM_ZERO_CALIBRATION" };

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
      // Stepping away from Device mode mid-calibration would otherwise
      // strand calibratingZero/pendingZeroSample -- the "Zero aim" button
      // isn't reachable outside Device mode, so there'd be no way back in
      // to confirm or cancel it.
      if (action.mode !== "device" && state.device.calibratingZero) {
        return {
          ...state,
          sourceMode: action.mode,
          device: { ...state.device, calibratingZero: false, pendingZeroSample: null },
        };
      }
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
        roundScores: finished ? { ...state.roundScores, [state.hole.id]: strokeCount } : state.roundScores,
      };
    }

    case "TOGGLE_SKIP_ANIMATION":
      return { ...state, skipAnimation: !state.skipAnimation };

    case "RESET":
      // Replays the SAME hole (practice: hit the same tee shot repeatedly)
      // -- not a new range session, so the device stays connected, the aim
      // zero stays set, and the round-so-far isn't erased. Re-pairing and
      // re-zeroing on every replay would be exactly the workflow friction
      // M3 was supposed to remove.
      return {
        ...createInitialState(action.hole, action.clubId, state.device.address),
        courseHoleIndex: state.courseHoleIndex,
        roundScores: state.roundScores,
        device: state.device,
      };

    case "GO_TO_HOLE":
      // Same posture as RESET, but for a specific hole -- sequential
      // "next hole" advance and hole-select's "jump here to practice" are
      // the same transition, just a different index.
      return {
        ...createInitialState(action.hole, action.clubId, state.device.address),
        courseHoleIndex: action.index,
        roundScores: state.roundScores,
        device: state.device,
      };

    case "NEW_ROUND":
      // Unlike RESET/GO_TO_HOLE, deliberately clears roundScores -- this is
      // "start over," not "replay/jump while keeping the card so far."
      return {
        ...createInitialState(action.hole, action.clubId, state.device.address),
        device: state.device,
      };

    case "SET_DEVICE_ADDRESS":
      return { ...state, device: { ...state.device, address: action.address } };

    case "DEVICE_CONNECTION_STATE":
      return { ...state, device: { ...state.device, connectionState: action.state } };

    case "DEVICE_INFO":
      return { ...state, device: { ...state.device, deviceInfo: action.info } };

    case "DEVICE_STATUS":
      return { ...state, device: { ...state.device, status: action.status } };

    case "START_AIM_ZERO_CALIBRATION":
      return { ...state, device: { ...state.device, calibratingZero: true, pendingZeroSample: null } };

    case "AIM_ZERO_SAMPLE_RECEIVED":
      return { ...state, device: { ...state.device, pendingZeroSample: action.raw } };

    case "CONFIRM_AIM_ZERO": {
      const sample = state.device.pendingZeroSample;
      return {
        ...state,
        device: {
          ...state.device,
          sessionZeroDeg: sample?.startLineDeg ?? 0,
          zeroConfirmed: true,
          calibratingZero: false,
          pendingZeroSample: null,
        },
      };
    }

    case "CANCEL_AIM_ZERO_CALIBRATION":
      return { ...state, device: { ...state.device, calibratingZero: false, pendingZeroSample: null } };

    default:
      return state;
  }
}

export function createInitialState(hole: Hole, initialClubId: ClubId, initialDeviceAddress: string = DEFAULT_DEVICE_ADDRESS): GameState {
  return {
    hole,
    courseHoleIndex: 0,
    roundScores: {},
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

    device: createInitialDeviceState(initialDeviceAddress),
  };
}
