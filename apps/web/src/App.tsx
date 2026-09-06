import { degToRad } from "@mulligan/physics";
import { COURSE, headingToward, isPenaltySurface, resolvePutt, resolveShot, summarizeScore, surfaceAt } from "@mulligan/game";
import {
  CLUBS,
  FULL_SWING_FRACTION,
  ManualShotSource,
  NetworkShotSource,
  ShotLog,
  SimulatedShotSource,
  enrichShot,
  exportSession,
  findClub,
  importSessionFromJSON,
  isWedge,
  loadImportedSessionIntoLog,
  mulberry32,
  sessionExportToJSON,
  type ClubId,
  type RawShotEvent,
} from "@mulligan/shot-source";
import { useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent } from "react";
import { expectedCarryYds } from "./game/expectedCarry";
import { DEFAULT_DEVICE_ADDRESS, createInitialState, gameReducer, type ShotHistoryEntry } from "./game/gameState";
import { HoleCanvas } from "./game/HoleCanvas";
import { usePrefersReducedMotion } from "./motion";
import { AimSlider } from "./ui/AimSlider";
import { ClubPicker } from "./ui/ClubPicker";
import { CourseScorecard } from "./ui/CourseScorecard";
import { DistanceHero } from "./ui/DistanceHero";
import { HoleSelect } from "./ui/HoleSelect";
import { ManualEntryPanel } from "./ui/ManualEntryPanel";
import { Onboarding } from "./ui/Onboarding";
import { PuttingPanel } from "./ui/PuttingPanel";
import { ScorecardSummary } from "./ui/ScorecardSummary";
import { SettingsSheet } from "./ui/SettingsSheet";
import { ShotReadout, type ShotReadoutData } from "./ui/ShotReadout";
import { SwingFractionSlider } from "./ui/SwingFractionSlider";
import { TopBar } from "./ui/TopBar";
import "./App.css";

const INITIAL_CLUB = "7i";
const DEVICE_ADDRESS_STORAGE_KEY = "mulligan:device-address";
const ONBOARDING_SEEN_KEY = "mulligan:onboarding-seen";

function readStoredDeviceAddress(): string {
  try {
    return localStorage.getItem(DEVICE_ADDRESS_STORAGE_KEY) ?? DEFAULT_DEVICE_ADDRESS;
  } catch {
    return DEFAULT_DEVICE_ADDRESS;
  }
}

function readOnboardingSeen(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
  } catch {
    return false; // private window or disabled storage -- show it once per tab session rather than never
  }
}

/** One line, always -- the small status text under the Swing button. */
function sourceStatusText(
  sourceMode: "simulated" | "manual" | "device",
  device: ReturnType<typeof createInitialState>["device"],
): string {
  if (sourceMode === "simulated") return "Simulated shots";
  if (sourceMode === "manual") return "Manual entry";
  switch (device.connectionState) {
    case "connected":
      return device.deviceInfo ? `Connected · ${device.deviceInfo.deviceId}` : "Connected";
    case "connecting":
      return "Connecting to device…";
    case "error":
      return "Device connection error — open Settings";
    default:
      return "No device connected — open Settings";
  }
}

function connectionDotClass(
  sourceMode: "simulated" | "manual" | "device",
  device: ReturnType<typeof createInitialState>["device"],
): string {
  if (sourceMode !== "device") return "conn-dot-neutral";
  if (device.connectionState === "connected") return "conn-dot-on";
  if (device.connectionState === "connecting") return "conn-dot-pending";
  if (device.connectionState === "error") return "conn-dot-error";
  return "conn-dot-off";
}

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    createInitialState(COURSE[0]!, INITIAL_CLUB, readStoredDeviceAddress()),
  );

  // NetworkShotSource's onShot/onConnectionStateChange/etc callbacks are
  // registered exactly once, at connect time (see handleConnectDevice) --
  // they must not close over a single render's `state`, or every device
  // shot after that render would be judged against stale game state
  // (wrong phase, wrong selected club, a zero from two clubs ago). Every
  // callback that isn't invoked fresh from JSX reads `stateRef.current`
  // instead of `state` directly for this reason.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const simulatedRef = useRef<SimulatedShotSource | null>(null);
  const manualRef = useRef<ManualShotSource | null>(null);
  const networkRef = useRef<NetworkShotSource | null>(null);
  const shotLogRef = useRef<ShotLog | null>(null);
  // Seed stored (not just consumed) and logged on every putt -- same
  // reproducibility contract as SimulatedShotSource.seed, since a putting
  // sequence that can't be replayed defeats the point of the shot log.
  const puttingSeedRef = useRef<number>(Date.now());
  const puttingRngRef = useRef(mulberry32(puttingSeedRef.current));
  const sessionIdRef = useRef<string>(`session-${Date.now()}`);
  const [sourcesReady, setSourcesReady] = useState(false);
  const [swingError, setSwingError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [holeSelectOpen, setHoleSelectOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !readOnboardingSeen());

  function handleOnboardingDone(): void {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    } catch {
      // Best effort -- worst case it shows again next launch in a private window.
    }
  }
  const reducedMotion = usePrefersReducedMotion();

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
      networkRef.current?.stop();
    };
  }, []);

  // The device address field is a session convenience, not game state that
  // needs to be pure/replayable -- persisted directly here rather than
  // threaded through the reducer.
  useEffect(() => {
    try {
      localStorage.setItem(DEVICE_ADDRESS_STORAGE_KEY, state.device.address);
    } catch {
      // Best effort -- a private window or disabled storage just means the
      // field doesn't remember itself next launch.
    }
  }, [state.device.address]);

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
  const readoutData: ShotReadoutData | null =
    state.phase === "shot" && lastEntry
      ? {
          key: String(lastEntry.raw.timestamp),
          club: findClub(lastEntry.clubId),
          carryYds: lastEntry.result.carryYds,
          totalYds: lastEntry.result.totalYds,
          ballSpeedMph: lastEntry.shot.ballSpeedMph,
          launchDeg: lastEntry.shot.launchDeg,
          spinRpm: lastEntry.shot.spinRpm,
          provenance: lastEntry.shot.provenance,
        }
      : null;

  // Shared tail for every shot regardless of where the RawShotEvent came
  // from (manual sliders, the simulator, or a real device push) -- reads
  // stateRef.current rather than `state` so the same function is safe to
  // call from handleSwing (a fresh closure every render) AND from
  // handleDeviceRawShot (a closure fixed once, at connect time).
  function resolveAndPlayShot(raw: RawShotEvent, clubId: ClubId, swingFraction?: number): void {
    const log = shotLogRef.current;
    const current = stateRef.current;
    if (!log) return;

    const aimHeading = headingToward(current.ballPos, current.hole.pin) + degToRad(current.aimOffsetDeg);
    const shot = enrichShot(raw, clubId);
    const result = resolveShot(current.hole, current.ballPos, aimHeading, shot);
    const entry: ShotHistoryEntry = { clubId, raw, shot, result };
    const penalty = isPenaltySurface(result.restSurface) ? result.restSurface : null;

    setSwingError(null);
    dispatch({ type: "SWING_RESOLVED", entry });
    log.append({
      sessionId: sessionIdRef.current,
      timestamp: raw.timestamp,
      strokeNumber: current.strokeCount + 1,
      isPutt: false,
      penalty,
      raw,
      shot,
      rest: result.rest,
      landingSurface: result.landingSurface,
      restSurface: result.restSurface,
      swingFraction,
    });
  }

  function handleSwing() {
    if (state.pendingShot || state.phase !== "shot") return;

    try {
      if (state.sourceMode === "manual") {
        const manual = manualRef.current;
        if (!manual) return;
        const raw: RawShotEvent = { ...state.manualValues, timestamp: Date.now() };
        manual.emit(raw);
        resolveAndPlayShot(raw, state.selectedClubId);
      } else if (state.sourceMode === "simulated") {
        const simulated = simulatedRef.current;
        if (!simulated) return;
        const raw = simulated.hit(state.selectedClubId, Date.now(), effectiveSwingFraction);
        resolveAndPlayShot(
          raw,
          state.selectedClubId,
          effectiveSwingFraction !== FULL_SWING_FRACTION ? effectiveSwingFraction : undefined,
        );
      }
      // Device mode has no manual trigger -- shots arrive via handleDeviceRawShot below.
    } catch (err) {
      // A game action must never crash the whole app -- surface it and let
      // the player try a different club/aim/manual value instead.
      setSwingError(err instanceof Error ? err.message : "That shot couldn't be resolved. Try different numbers.");
    }
  }

  // Registered once with NetworkShotSource.onShot() at connect time, so
  // everything it reads comes from stateRef.current, not the `state` this
  // render captured.
  function handleDeviceRawShot(raw: RawShotEvent): void {
    const current = stateRef.current;

    if (current.device.calibratingZero) {
      dispatch({ type: "AIM_ZERO_SAMPLE_RECEIVED", raw });
      return;
    }
    if (current.sourceMode !== "device" || current.phase !== "shot" || current.pendingShot) {
      // A device shot that arrives while the player isn't actively playing
      // in Device mode (still browsing Simulated, mid flight animation, on
      // the putting green) is dropped rather than queued -- there is no
      // sensible "later" for a swing that already happened.
      return;
    }

    try {
      // Only startLineDeg gets the session-zero correction -- see
      // DeviceSessionState.sessionZeroDeg's doc comment for why spinAxisDeg
      // doesn't need the same treatment.
      const corrected: RawShotEvent =
        raw.startLineDeg !== undefined ? { ...raw, startLineDeg: raw.startLineDeg - current.device.sessionZeroDeg } : raw;
      resolveAndPlayShot(corrected, current.selectedClubId);
    } catch (err) {
      setSwingError(err instanceof Error ? err.message : "That shot couldn't be resolved.");
    }
  }

  function handleConnectDevice(): void {
    networkRef.current?.stop();
    const source = new NetworkShotSource({ url: stateRef.current.device.address });
    networkRef.current = source;
    source.onConnectionStateChange((s) => dispatch({ type: "DEVICE_CONNECTION_STATE", state: s }));
    source.onDeviceInfo((info) => dispatch({ type: "DEVICE_INFO", info }));
    source.onStatus((status) => dispatch({ type: "DEVICE_STATUS", status }));
    source.onShot(handleDeviceRawShot);
    source.start();
  }

  function handleDisconnectDevice(): void {
    // stop() itself synchronously fires the "disconnected" state through
    // the onConnectionStateChange listener registered in
    // handleConnectDevice -- no separate dispatch needed here.
    networkRef.current?.stop();
    networkRef.current = null;
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

  // Hole transitions (next/select) all stay inside the SAME session -- a
  // round is one range visit, and fragmenting its shot log across a new
  // "session" per hole would only make session review/export (Part F)
  // less coherent. Only a deliberate "New round" starts fresh. Replaying
  // the current hole is just selecting it again from HoleSelect -- no
  // separate action needed.
  function handleNextHole() {
    const nextIndex = state.courseHoleIndex + 1;
    const nextHole = COURSE[nextIndex];
    if (!nextHole) return; // last hole -- CourseScorecard takes over instead of this button existing
    dispatch({ type: "GO_TO_HOLE", index: nextIndex, hole: nextHole, clubId: INITIAL_CLUB });
    setSwingError(null);
  }

  function handleSelectHole(index: number) {
    const hole = COURSE[index];
    if (!hole) return;
    dispatch({ type: "GO_TO_HOLE", index, hole, clubId: INITIAL_CLUB });
    setSwingError(null);
    setHoleSelectOpen(false);
  }

  function handleNewRound() {
    dispatch({ type: "NEW_ROUND", hole: COURSE[0]!, clubId: INITIAL_CLUB });
    setSwingError(null);
    sessionIdRef.current = `session-${Date.now()}`;
  }

  // A recorded session is the most valuable data this project has once
  // real range shots are in it -- it must be able to leave the phone.
  // Exports everything ShotLog knows about this session (every
  // RawShotEvent/ShotEvent/provenance/rest position) plus session-level
  // facts the log itself doesn't track: the aim zero and the simulator
  // seed, if one was in use.
  function handleExportSession(): void {
    const log = shotLogRef.current;
    if (!log) return;

    const exported = exportSession(log, sessionIdRef.current, {
      sessionZeroDeg: state.device.sessionZeroDeg,
      simulatedSeed: simulatedRef.current?.seed,
    });
    if (exported.entries.length === 0) {
      setSessionMessage("Nothing to export yet — play a shot first.");
      return;
    }
    const blob = new Blob([sessionExportToJSON(exported)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mulligan-session-${sessionIdRef.current}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setSessionMessage(`Exported ${exported.entries.length} stroke${exported.entries.length === 1 ? "" : "s"}.`);
  }

  // Loads a previously exported file's entries into this browser's actual
  // ShotLog under their original session id -- the data-portability half
  // of export: a session exported on one phone can be brought back in on
  // another and handed to a ReplayShotSource there. Does not touch the
  // current round in progress.
  function handleImportSessionFile(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same filename later
    if (!file) return;

    file
      .text()
      .then((text) => {
        const imported = importSessionFromJSON(text);
        const log = shotLogRef.current;
        if (log) loadImportedSessionIntoLog(imported, log);
        setSessionMessage(
          `Imported ${imported.entries.length} stroke${imported.entries.length === 1 ? "" : "s"} from session "${imported.sessionId}".`,
        );
      })
      .catch((err) => {
        setSessionMessage(err instanceof Error ? `Import failed: ${err.message}` : "Import failed. Check the file and try again.");
      });
  }

  const animating = state.pendingShot !== null;
  const canSwing = sourcesReady && !animating && state.phase === "shot";
  const controlsDisabled = animating || state.phase !== "shot";

  return (
    <div className="app">
      <TopBar
        holeName={state.hole.name}
        holeNumber={state.courseHoleIndex + 1}
        courseLength={COURSE.length}
        par={state.hole.par}
        strokeNumber={state.strokeCount + 1}
        onOpenHoleSelect={() => setHoleSelectOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        connectionDotClassName={connectionDotClass(state.sourceMode, state.device)}
      />

      {sessionMessage && (
        <div className="session-message">
          {sessionMessage}
          <button type="button" className="session-message-dismiss" onClick={() => setSessionMessage(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {state.phase !== "holed" && (
        <DistanceHero distanceToPinYds={distanceToPinYds} surface={currentSurface} lastPenalty={state.lastPenalty} />
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
          reducedMotion={reducedMotion}
          onShotSettled={() => dispatch({ type: "SHOT_SETTLED" })}
        />
      </div>

      {state.phase === "holed" ? (
        state.courseHoleIndex === COURSE.length - 1 ? (
          <CourseScorecard
            course={COURSE}
            roundScores={state.roundScores}
            onNewRound={handleNewRound}
            onHoleSelect={() => setHoleSelectOpen(true)}
          />
        ) : (
          <ScorecardSummary
            hole={state.hole}
            breakdown={summarizeScore(
              state.strokesToGreen ?? state.strokeCount,
              state.strokeCount - (state.strokesToGreen ?? state.strokeCount),
              state.hole.par,
            )}
            paths={previousPaths}
            restSpots={previousRestSpots}
            continueLabel="Next hole"
            onContinue={handleNextHole}
          />
        )
      ) : (
        <>
          {state.phase === "shot" && <ShotReadout data={readoutData} skipAnimation={state.skipAnimation || reducedMotion} />}

          {state.phase === "shot" && (
            <div className="controls">
              <AimSlider
                aimOffsetDeg={state.aimOffsetDeg}
                disabled={controlsDisabled}
                onChange={(deg) => dispatch({ type: "SET_AIM_OFFSET_DEG", deg })}
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

              <div className="bottom-third">
                <ClubPicker
                  clubs={CLUBS}
                  selectedClubId={state.selectedClubId}
                  surface={currentSurface}
                  disabled={controlsDisabled}
                  onSelect={(clubId) => dispatch({ type: "SELECT_CLUB", clubId })}
                />

                <div className="hitrow">
                  {state.sourceMode === "device" ? (
                    <div className="device-waiting">
                      {state.device.connectionState !== "connected"
                        ? "Connect a device in Settings to play"
                        : state.device.calibratingZero
                          ? "Zeroing — hit a shot toward your target"
                          : "Waiting for a shot from the device…"}
                    </div>
                  ) : (
                    <button type="button" className="hit" disabled={!canSwing} onClick={handleSwing}>
                      {sourcesReady ? "Swing" : "Loading…"}
                    </button>
                  )}
                </div>
                <div className="swing-meta">
                  <span>
                    {selectedClub.name} · ~{Math.round(clubExpectedCarry)} yds
                  </span>
                  <span className="swing-meta-status">{sourceStatusText(state.sourceMode, state.device)}</span>
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
        </>
      )}

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sourceMode={state.sourceMode}
        onSourceModeChange={(mode) => dispatch({ type: "SET_SOURCE_MODE", mode })}
        device={state.device}
        onDeviceAddressChange={(address) => dispatch({ type: "SET_DEVICE_ADDRESS", address })}
        onConnectDevice={handleConnectDevice}
        onDisconnectDevice={handleDisconnectDevice}
        onAimZeroStart={() => dispatch({ type: "START_AIM_ZERO_CALIBRATION" })}
        onAimZeroConfirm={() => dispatch({ type: "CONFIRM_AIM_ZERO" })}
        onAimZeroCancel={() => dispatch({ type: "CANCEL_AIM_ZERO_CALIBRATION" })}
        onExportSession={handleExportSession}
        onImportSessionFile={handleImportSessionFile}
      />

      {holeSelectOpen && (
        <HoleSelect
          course={COURSE}
          currentIndex={state.courseHoleIndex}
          roundScores={state.roundScores}
          onSelect={handleSelectHole}
          onClose={() => setHoleSelectOpen(false)}
        />
      )}

      {showOnboarding && <Onboarding onDone={handleOnboardingDone} />}
    </div>
  );
}
