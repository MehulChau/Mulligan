import { degToRad } from "@mulligan/physics";
import { HOLE_1, headingToward, isPenaltySurface, resolvePutt, resolveShot, summarizeScore, surfaceAt } from "@mulligan/game";
import {
  CLUBS,
  FULL_SWING_FRACTION,
  ManualShotSource,
  ShotLog,
  SimulatedShotSource,
  enrichShot,
  findClub,
  isWedge,
  mulberry32,
  type RawShotEvent,
} from "@mulligan/shot-source";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { expectedCarryYds } from "./game/expectedCarry";
import { HoleCanvas } from "./game/HoleCanvas";
import { createInitialState, gameReducer, type ShotHistoryEntry } from "./game/gameState";
import { AimSlider } from "./ui/AimSlider";
import { ClubPicker } from "./ui/ClubPicker";
import { HoleCompleteSummary } from "./ui/HoleCompleteSummary";
import { Hud } from "./ui/Hud";
import { ManualEntryPanel } from "./ui/ManualEntryPanel";
import { PuttingPanel } from "./ui/PuttingPanel";
import { SourceModeToggle } from "./ui/SourceModeToggle";
import { SwingFractionSlider } from "./ui/SwingFractionSlider";
import "./App.css";

const HOLE = HOLE_1;
const INITIAL_CLUB = "7i";

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createInitialState(HOLE, INITIAL_CLUB));

  const simulatedRef = useRef<SimulatedShotSource | null>(null);
  const manualRef = useRef<ManualShotSource | null>(null);
  const shotLogRef = useRef<ShotLog | null>(null);
  // Seed stored (not just consumed) and logged on every putt -- same
  // reproducibility contract as SimulatedShotSource.seed, since a putting
  // sequence that can't be replayed defeats the point of the shot log.
  const puttingSeedRef = useRef<number>(Date.now());
  const puttingRngRef = useRef(mulberry32(puttingSeedRef.current));
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
  const wedgeSelected = isWedge(state.selectedClubId);
  // Manual mode has its own direct-entry sliders (including ball speed), so
  // swing fraction only applies to a simulated wedge -- everything else
  // always swings full.
  const effectiveSwingFraction = state.sourceMode === "simulated" && wedgeSelected ? state.swingFraction : FULL_SWING_FRACTION;
  // expectedCarryYds computes lazily on first request per (club, fraction)
  // and caches the result (see game/expectedCarry.ts) -- cheap enough on
  // every render that no memoization is needed here; only the first tap on
  // a given club/fraction does real work.
  const clubExpectedCarry = expectedCarryYds(state.selectedClubId, effectiveSwingFraction);

  const previousPaths = useMemo(() => state.shotHistory.map((entry) => entry.result.path2d), [state.shotHistory]);
  const previousRestSpots = useMemo(() => state.shotHistory.map((entry) => entry.result.rest), [state.shotHistory]);

  const lastEntry: ShotHistoryEntry | undefined = state.shotHistory[state.shotHistory.length - 1];

  function handleSwing() {
    const log = shotLogRef.current;
    if (!log || state.pendingShot || state.phase !== "shot") return;

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
        raw = simulated.hit(state.selectedClubId, Date.now(), effectiveSwingFraction);
      }

      const shot = enrichShot(raw, state.selectedClubId);
      const result = resolveShot(state.hole, state.ballPos, aimHeadingRad, shot);
      const entry: ShotHistoryEntry = { clubId: state.selectedClubId, raw, shot, result };
      const penalty = isPenaltySurface(result.restSurface) ? result.restSurface : null;

      setSwingError(null);
      dispatch({ type: "SWING_RESOLVED", entry });
      log.append({
        sessionId: sessionIdRef.current,
        timestamp: raw.timestamp,
        strokeNumber: state.strokeCount + 1,
        isPutt: false,
        penalty,
        raw,
        shot,
        rest: result.rest,
        landingSurface: result.landingSurface,
        restSurface: result.restSurface,
        swingFraction:
          state.sourceMode === "simulated" && effectiveSwingFraction !== FULL_SWING_FRACTION
            ? effectiveSwingFraction
            : undefined,
      });
    } catch (err) {
      // A game action must never crash the whole app -- surface it and let
      // the player try a different club/aim/manual value instead.
      setSwingError(err instanceof Error ? err.message : "That shot couldn't be resolved. Try different numbers.");
    }
  }

  function handlePutt() {
    const log = shotLogRef.current;
    if (!log || state.phase !== "putting") return;

    const result = resolvePutt(state.puttDistanceYds, puttingRngRef.current);
    dispatch({ type: "PUTT_RESOLVED", result });
    log.append({
      sessionId: sessionIdRef.current,
      timestamp: Date.now(),
      strokeNumber: state.strokeCount + 1,
      isPutt: true,
      penalty: null,
      puttDistanceBeforeYds: result.distanceBefore,
      puttDistanceAfterYds: result.distanceAfter,
      holed: result.holed,
      puttingSeed: puttingSeedRef.current,
    });
  }

  function handlePlayAgain() {
    dispatch({ type: "RESET", hole: HOLE, clubId: INITIAL_CLUB });
    setSwingError(null);
    sessionIdRef.current = `session-${Date.now()}`;
  }

  const animating = state.pendingShot !== null;
  const canSwing = sourcesReady && !animating && state.phase === "shot";
  const controlsDisabled = animating || state.phase !== "shot";

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          Mulligan<span className="hole-name"> · {state.hole.name}</span>
        </h1>
      </header>

      {state.phase !== "holed" && (
        <Hud
          distanceToPinYds={distanceToPinYds}
          surface={currentSurface}
          strokeCount={state.strokeCount}
          par={state.hole.par}
          selectedClub={selectedClub}
          expectedCarryYds={clubExpectedCarry}
          lastShot={
            state.phase === "shot" && lastEntry
              ? { carryYds: lastEntry.result.carryYds, totalYds: lastEntry.result.totalYds, provenance: lastEntry.shot.provenance }
              : null
          }
          lastPenalty={state.lastPenalty}
        />
      )}

      {state.phase === "holed" && (
        <HoleCompleteSummary
          breakdown={summarizeScore(state.strokesToGreen ?? state.strokeCount, state.strokeCount - (state.strokesToGreen ?? state.strokeCount), state.hole.par)}
          onPlayAgain={handlePlayAgain}
        />
      )}

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

      {state.phase === "shot" && (
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
            surface={currentSurface}
            disabled={controlsDisabled}
            onSelect={(clubId) => dispatch({ type: "SELECT_CLUB", clubId })}
          />

          {state.sourceMode === "simulated" && wedgeSelected && (
            <SwingFractionSlider
              fraction={state.swingFraction}
              expectedCarryYds={clubExpectedCarry}
              disabled={controlsDisabled}
              onChange={(fraction) => dispatch({ type: "SET_SWING_FRACTION", fraction })}
            />
          )}

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

      {state.phase === "putting" && (
        <PuttingPanel
          puttDistanceYds={state.puttDistanceYds}
          puttAttempts={state.puttAttempts}
          lastPuttResult={state.lastPuttResult}
          disabled={!sourcesReady}
          onPutt={handlePutt}
        />
      )}
    </div>
  );
}
