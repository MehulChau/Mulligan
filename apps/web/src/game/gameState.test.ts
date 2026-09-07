import {
  COURSE,
  clubAvailability,
  firstAvailableClub,
  headingToward,
  isPenaltySurface,
  resolvePutt,
  resolveShot,
  surfaceAt,
  type SurfaceType,
} from "@mulligan/game";
import { degToRad } from "@mulligan/physics";
import { CLUBS, SimulatedShotSource, enrichShot, isWedge, mulberry32, type ClubId } from "@mulligan/shot-source";
import { describe, expect, it } from "vitest";
import { expectedCarryYds } from "./expectedCarry";
import { createInitialState, gameReducer, type GameState } from "./gameState";

const WEDGE_FRACTIONS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/**
 * A deliberately simple "competent enough" club/fraction choice -- closest
 * expected carry to the remaining distance, among clubs legal for the
 * current lie, preferring not to overshoot. This is NOT the full
 * hazard-aware policy tools/lib/playtestEngine.ts uses for game-balance
 * analysis (a different concern, outside this package's dependency graph)
 * -- it exists only so this property test exercises the same
 * partial-swing-wedge mechanic a real player uses. An earlier version of
 * this test always swung every club at 100% and every one of 100 seeds
 * failed to terminate within 60 turns -- not a bug in the app, but a
 * reproduction of the exact pre-M2a.1 dead end (see CLAUDE.md's M2a.1
 * section): a full-swing-only lob wedge can't get inside the 5-yard
 * fringe from 15 yards out. Choosing a swing fraction is what closes that.
 */
function chooseClubAndFraction(surface: SurfaceType, distanceYds: number): { clubId: ClubId; fraction: number } {
  const candidates: { clubId: ClubId; fraction: number; carry: number }[] = [];
  for (const club of CLUBS) {
    if (!clubAvailability(surface, club.id).available) continue;
    const fractions = isWedge(club.id) ? WEDGE_FRACTIONS : [1.0];
    for (const fraction of fractions) candidates.push({ clubId: club.id, fraction, carry: expectedCarryYds(club.id, fraction) });
  }
  if (candidates.length === 0) {
    return { clubId: firstAvailableClub(surface, CLUBS), fraction: 1.0 };
  }
  const notOvershooting = candidates.filter((c) => c.carry <= distanceYds + 3);
  const pool = notOvershooting.length > 0 ? notOvershooting : candidates;
  pool.sort((a, b) => Math.abs(a.carry - distanceYds) - Math.abs(b.carry - distanceYds));
  return { clubId: pool[0]!.clubId, fraction: pool[0]!.fraction };
}

function distanceTo(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Drives the reducer through one full turn (a ball-flight swing, or a
 * putt) exactly the way App.tsx's resolveAndPlayShot/handlePutt do --
 * SWING_RESOLVED then SHOT_SETTLED for a shot (skipping animation, which
 * is a rendering concern with no reducer-visible effect), PUTT_RESOLVED
 * for a putt. That app-side logic lives as closures inside App.tsx, not
 * exported, so this reproduces the relevant slice rather than importing
 * it -- proportionate for what these tests need, not a case for a larger
 * refactor.
 */
function playOneTurn(state: GameState, source: SimulatedShotSource, puttRng: () => number): GameState {
  if (state.phase === "putting") {
    const result = resolvePutt(state.puttDistanceYds, puttRng);
    return gameReducer(state, { type: "PUTT_RESOLVED", result });
  }

  const { hole, ballPos } = state;
  const surface = surfaceAt(hole, ballPos);
  const distanceYds = distanceTo(ballPos, hole.pin);
  const { clubId, fraction } = chooseClubAndFraction(surface, distanceYds);

  let next = clubId === state.selectedClubId ? state : gameReducer(state, { type: "SELECT_CLUB", clubId });
  if (isWedge(clubId)) next = gameReducer(next, { type: "SET_SWING_FRACTION", fraction });

  const raw = source.hit(clubId, Date.now(), fraction);
  const shot = enrichShot(raw, clubId);
  const aimHeading = headingToward(next.ballPos, next.hole.pin) + degToRad(next.aimOffsetDeg);
  const result = resolveShot(next.hole, next.ballPos, aimHeading, shot);
  const entry = { clubId, raw, shot, result };

  next = gameReducer(next, { type: "SWING_RESOLVED", entry });
  next = gameReducer(next, { type: "SHOT_SETTLED" });
  return next;
}

/** A generous cap -- Monte Carlo playtesting (tools/course-playtest.ts) sees real rounds finish in 3-6 strokes; 60 is "something is badly wrong," not "an unlucky round." */
const MAX_TURNS = 60;

function playRandomRound(seed: number): { finalState: GameState; turns: number } {
  const source = new SimulatedShotSource({ seed, fidelity: "full" });
  source.start(); // synchronous in effect -- no await inside BaseShotSource.start() before it flips `started`
  const puttRng = mulberry32(seed + 1_000_000); // a distinct stream from the shot source's own, same separation App.tsx keeps
  let state = createInitialState(COURSE[0]!, "7i");
  let turns = 0;
  while (state.phase !== "holed" && turns < MAX_TURNS) {
    state = playOneTurn(state, source, puttRng);
    turns++;
  }
  return { finalState: state, turns };
}

describe("gameState: round termination and consistency (property-style)", () => {
  it("a round always reaches 'holed' within a bounded number of turns, across many random seeds", () => {
    const failures: number[] = [];
    for (let seed = 1; seed <= 100; seed++) {
      const { finalState, turns } = playRandomRound(seed);
      if (finalState.phase !== "holed" || turns >= MAX_TURNS) failures.push(seed);
    }
    expect(failures).toEqual([]);
  });

  it("strokeCount always accounts for every turn played, plus any penalties (never fewer)", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { finalState, turns } = playRandomRound(seed);
      expect(finalState.strokeCount).toBeGreaterThanOrEqual(turns);
      expect(finalState.shotHistory.length).toBeLessThanOrEqual(finalState.strokeCount);
    }
  });

  it("shotHistory only grows on a ball-flight swing, never on a putt, and never loses an entry", () => {
    const source = new SimulatedShotSource({ seed: 42, fidelity: "full" });
    source.start();
    const puttRng = mulberry32(42 + 1_000_000);
    let state = createInitialState(COURSE[0]!, "driver");
    let previousLength = 0;
    let turns = 0;
    while (state.phase !== "holed" && turns < MAX_TURNS) {
      const wasShot = state.phase === "shot";
      state = playOneTurn(state, source, puttRng);
      if (wasShot) {
        expect(state.shotHistory.length).toBe(previousLength + 1);
        previousLength = state.shotHistory.length;
      } else {
        expect(state.shotHistory.length).toBe(previousLength);
      }
      turns++;
    }
    expect(state.phase).toBe("holed");
  });

  it("penalty strokes only ever increase strokeCount, and ballPos never goes NaN", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const source = new SimulatedShotSource({ seed, fidelity: "full" });
      source.start();
      const puttRng = mulberry32(seed + 1_000_000);
      let state = createInitialState(COURSE[0]!, "driver");
      let lastStrokeCount = 0;
      let turns = 0;
      while (state.phase !== "holed" && turns < MAX_TURNS) {
        state = playOneTurn(state, source, puttRng);
        expect(state.strokeCount).toBeGreaterThanOrEqual(lastStrokeCount);
        expect(Number.isFinite(state.ballPos.x)).toBe(true);
        expect(Number.isFinite(state.ballPos.y)).toBe(true);
        lastStrokeCount = state.strokeCount;
        turns++;
      }
    }
  });

  it("a shot resolving to a water/OOB restSurface applies its penalty deterministically (SHOT_SETTLED's penalty branch), rather than relying on random luck to reach a hazard", () => {
    const source = new SimulatedShotSource({ seed: 1, fidelity: "full" });
    source.start();
    const state = createInitialState(COURSE[0]!, "7i");
    const raw = source.hit("7i", Date.now());
    const shot = enrichShot(raw, "7i");
    const aimHeading = headingToward(state.ballPos, state.hole.pin);
    const realResult = resolveShot(state.hole, state.ballPos, aimHeading, shot);
    // Force the outcome, not the input -- everything about the swing is
    // real (a real SimulatedShotSource shot run through the real
    // resolver), only restSurface is overridden to guarantee the
    // reducer's penalty branch actually runs instead of hoping a random
    // seed happens to land in a hazard.
    const forcedWaterResult = { ...realResult, restSurface: "water" as const };
    const entry = { clubId: "7i" as const, raw, shot, result: forcedWaterResult };

    let next = gameReducer(state, { type: "SWING_RESOLVED", entry });
    next = gameReducer(next, { type: "SHOT_SETTLED" });

    expect(next.lastPenalty).toBe("water");
    expect(next.strokeCount).toBe(state.strokeCount + 2); // the stroke itself, plus the 1-stroke penalty
    expect(next.phase).toBe("shot"); // a penalty drop is never itself "holed"
    expect(Number.isFinite(next.ballPos.x)).toBe(true);
    expect(Number.isFinite(next.ballPos.y)).toBe(true);
  });
});

describe("gameState: isPenaltySurface sanity", () => {
  it("water and out are the only penalty surfaces", () => {
    expect(isPenaltySurface("water")).toBe(true);
    expect(isPenaltySurface("out")).toBe(true);
    expect(isPenaltySurface("fairway")).toBe(false);
    expect(isPenaltySurface("green")).toBe(false);
  });
});
