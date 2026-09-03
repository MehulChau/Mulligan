import { degToRad } from "@mulligan/physics";
import { HOLE_1, headingToward, resolveShot, surfaceAt } from "@mulligan/game";
import { CLUBS, ShotLog, SimulatedShotSource, enrichShot, findClub } from "@mulligan/shot-source";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { expectedCarryYds } from "./game/expectedCarry";
import { HoleCanvas } from "./game/HoleCanvas";
import { createInitialState, gameReducer, type ShotHistoryEntry } from "./game/gameState";
import { AimSlider } from "./ui/AimSlider";
import { ClubPicker } from "./ui/ClubPicker";
import { Hud } from "./ui/Hud";
import "./App.css";

const HOLE = HOLE_1;

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createInitialState(HOLE, "7i"));

  const shotSourceRef = useRef<SimulatedShotSource | null>(null);
  const shotLogRef = useRef<ShotLog | null>(null);
  const sessionIdRef = useRef<string>(`session-${Date.now()}`);
  const [sourceReady, setSourceReady] = useState(false);

  useEffect(() => {
    const source = new SimulatedShotSource();
    shotSourceRef.current = source;
    shotLogRef.current = new ShotLog();
    source.start().then(() => setSourceReady(true));
    return () => source.stop();
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

  const previousPaths = useMemo(
    () => state.shotHistory.map((entry) => entry.result.path2d),
    [state.shotHistory],
  );

  const lastEntry: ShotHistoryEntry | undefined = state.shotHistory[state.shotHistory.length - 1];

  function handleSwing() {
    const source = shotSourceRef.current;
    const log = shotLogRef.current;
    if (!source || !log || state.pendingShot || state.status !== "playing") return;

    const raw = source.hit(state.selectedClubId);
    const shot = enrichShot(raw, state.selectedClubId);
    const result = resolveShot(state.hole, state.ballPos, aimHeadingRad, shot);
    const entry: ShotHistoryEntry = { clubId: state.selectedClubId, raw, shot, result };

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
  }

  const canSwing = sourceReady && !state.pendingShot && state.status === "playing";

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
          pendingShot={state.pendingShot?.result ?? null}
          skipAnimation={state.skipAnimation}
          onShotSettled={() => dispatch({ type: "SHOT_SETTLED" })}
        />
      </div>

      {state.status === "playing" && (
        <div className="controls">
          <AimSlider aimOffsetDeg={state.aimOffsetDeg} onChange={(deg) => dispatch({ type: "SET_AIM_OFFSET_DEG", deg })} />
          <ClubPicker clubs={CLUBS} selectedClubId={state.selectedClubId} onSelect={(clubId) => dispatch({ type: "SELECT_CLUB", clubId })} />
          <div className="hitrow">
            <button type="button" className="hit" disabled={!canSwing} onClick={handleSwing}>
              Swing
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
    </div>
  );
}
