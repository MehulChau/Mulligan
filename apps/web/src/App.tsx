import { degToRad } from "@mulligan/physics";
import { HOLE_1, headingToward, resolveShot, surfaceAt } from "@mulligan/game";
import {
  CLUBS,
  ManualShotSource,
  ShotLog,
  SimulatedShotSource,
  enrichShot,
  findClub,
  type RawShotEvent,
} from "@mulligan/shot-source";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { expectedCarryYds } from "./game/expectedCarry";
import { HoleCanvas } from "./game/HoleCanvas";
import { createInitialState, gameReducer, type ShotHistoryEntry } from "./game/gameState";
import { AimSlider } from "./ui/AimSlider";
import { ClubPicker } from "./ui/ClubPicker";
import { Hud } from "./ui/Hud";
import { ManualEntryPanel } from "./ui/ManualEntryPanel";
import { SourceModeToggle } from "./ui/SourceModeToggle";
import "./App.css";

const HOLE = HOLE_1;
const INITIAL_CLUB = "7i";

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createInitialState(HOLE, INITIAL_CLUB));

  const simulatedRef = useRef<SimulatedShotSource | null>(null);
  const manualRef = useRef<ManualShotSource | null>(null);
  const shotLogRef = useRef<ShotLog | null>(null);
  const sessionIdRef = useRef<string>(`session-${Date.now()}`);
  const [sourcesReady, setSourcesReady] = useState(false);
  const [swingError, setSwingError] = useState<string | null>(null);

  useEffect(() => {
    const simulated = new SimulatedShotSource();
    const manual = new ManualShotSource();
    simulatedRef.current = simulated;
    manualRef.current = manual;
    shotLogRef.current = new ShotLog();
    Promise.all([simulated.start(), manual.start()]).then(() => setSourcesReady(true));
    return () => {
      simulated.stop();
      manual.stop();
    };
  }, []);

  const aimHeadingRad = useMemo(
    () => headingToward(state.ballPos, state.hole.pin) + degToRad(state.aimOffsetDeg),
    [state.ballPos, state.hole.pin, state.aimOffsetDeg],
  );

  const distanceToPinYds = useMemo(
    () => Math.hypot(state.hole.pin.x - state.ballPos.x, state.hole.pin.y - state.ballPos.y),
    [state.ballPos, state.hole.pin],
  );

  const currentSurface = useMemo(() => surfaceAt(state.hole, state.ballPos), [state.hole, state.ballPos]);

  const selectedClub = findClub(state.selectedClubId);
  // expectedCarryYds is an O(1) lookup into a table precomputed once at
  // module load (see game/expectedCarry.ts) -- no memoization needed here.
  const clubExpectedCarry = expectedCarryYds(state.selectedClubId);

  const previousPaths = useMemo(() => state.shotHistory.map((entry) => entry.result.path2d), [state.shotHistory]);
  const previousRestSpots = useMemo(() => state.shotHistory.map((entry) => entry.result.rest), [state.shotHistory]);

  const lastEntry: ShotHistoryEntry | undefined = state.shotHistory[state.shotHistory.length - 1];

  function handleSwing() {
    const log = shotLogRef.current;
    if (!log || state.pendingShot || state.status !== "playing") return;

    try {
      let raw: RawShotEvent;
      if (state.sourceMode === "manual") {
        const manual = manualRef.current;
        if (!manual) return;
        raw = { ...state.manualValues, timestamp: Date.now() };
        manual.emit(raw);
      } else {
        const simulated = simulatedRef.current;
        if (!simulated) return;
        raw = simulated.hit(state.selectedClubId);
      }

      const shot = enrichShot(raw, state.selectedClubId);
      const result = resolveShot(state.hole, state.ballPos, aimHeadingRad, shot);
      const entry: ShotHistoryEntry = { clubId: state.selectedClubId, raw, shot, result };

      setSwingError(null);
      dispatch({ type: "SWING_RESOLVED", entry });
      log.append({
        sessionId: sessionIdRef.current,
        timestamp: raw.timestamp,
        raw,
        shot,
        rest: result.rest,
        landingSurface: result.landingSurface,
        restSurface: result.restSurface,
      });
    } catch (err) {
      // A game action must never crash the whole app -- surface it and let
      // the player try a different club/aim/manual value instead.
      setSwingError(err instanceof Error ? err.message : "That shot couldn't be resolved. Try different numbers.");
    }
  }

  function handlePlayAgain() {
    dispatch({ type: "RESET", hole: HOLE, clubId: INITIAL_CLUB });
    setSwingError(null);
    sessionIdRef.current = `session-${Date.now()}`;
  }

  const animating = state.pendingShot !== null;
  const canSwing = sourcesReady && !animating && state.status === "playing";
  const controlsDisabled = animating || state.status !== "playing";

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          Mulligan<span className="hole-name"> · {state.hole.name}</span>
        </h1>
      </header>

      <Hud
        distanceToPinYds={distanceToPinYds}
        surface={currentSurface}
        shotNumber={state.shotHistory.length + 1}
        selectedClub={selectedClub}
        expectedCarryYds={clubExpectedCarry}
        lastShot={
          lastEntry
            ? { carryYds: lastEntry.result.carryYds, totalYds: lastEntry.result.totalYds, provenance: lastEntry.shot.provenance }
            : null
        }
        onGreenInShots={state.status === "on-green" ? state.shotHistory.length : null}
      />

      <div className="canvas-wrap">
        <HoleCanvas
          hole={state.hole}
          ballPos={state.ballPos}
          aimHeadingRad={aimHeadingRad}
          previousPaths={previousPaths}
          previousRestSpots={previousRestSpots}
          pendingShot={state.pendingShot?.result ?? null}
          skipAnimation={state.skipAnimation}
          onShotSettled={() => dispatch({ type: "SHOT_SETTLED" })}
        />
      </div>

      {state.status === "playing" && (
        <div className="controls">
          <SourceModeToggle
            mode={state.sourceMode}
            disabled={controlsDisabled}
            onChange={(mode) => dispatch({ type: "SET_SOURCE_MODE", mode })}
          />

          <AimSlider
            aimOffsetDeg={state.aimOffsetDeg}
            disabled={controlsDisabled}
            onChange={(deg) => dispatch({ type: "SET_AIM_OFFSET_DEG", deg })}
          />

          <ClubPicker
            clubs={CLUBS}
            selectedClubId={state.selectedClubId}
            disabled={controlsDisabled}
            onSelect={(clubId) => dispatch({ type: "SELECT_CLUB", clubId })}
          />

          {state.sourceMode === "manual" && (
            <ManualEntryPanel
              values={state.manualValues}
              disabled={controlsDisabled}
              onChange={(field, value) => dispatch({ type: "SET_MANUAL_VALUE", field, value })}
            />
          )}

          {swingError && <div className="swing-error">{swingError}</div>}

          <div className="hitrow">
            <button type="button" className="hit" disabled={!canSwing} onClick={handleSwing}>
              {sourcesReady ? "Swing" : "Loading…"}
            </button>
            <label className="skip-toggle">
              <input
                type="checkbox"
                checked={state.skipAnimation}
                onChange={() => dispatch({ type: "TOGGLE_SKIP_ANIMATION" })}
              />
              Skip animation
            </label>
          </div>
        </div>
      )}

      {state.status === "on-green" && (
        <div className="controls">
          <button type="button" className="hit" onClick={handlePlayAgain}>
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
