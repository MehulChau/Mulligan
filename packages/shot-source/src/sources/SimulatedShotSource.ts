import { findClub, type ClubId } from "../clubs";
import { DEFAULT_DISPERSION, simulateShot, type DispersionParams } from "../dispersion";
import { mulberry32 } from "../rng";
import { FULL_SWING_FRACTION, scaleClubForSwing, scaleDispersionForSwing } from "../swing";
import type { RawShotEvent } from "../types";
import { BaseShotSource } from "./ShotSource";

/**
 * 'full'   -- emits every generated field (ballSpeed, launch, spin, spin
 *             axis, start line). Useful for tests that want to control or
 *             inspect the whole simulated shot deterministically.
 * 'device' -- emits only what the real Pi can ever measure (ballSpeedMph,
 *             launchDeg, timestamp). This is what actually exercises
 *             enrichShot's estimation branches and the HUD's provenance
 *             display, so it's the fidelity the app runs in.
 */
export type ShotFidelity = "full" | "device";

export interface SimulatedShotSourceOptions {
  dispersion?: DispersionParams;
  seed?: number;
  fidelity?: ShotFidelity;
}

/** Emits a plausible (not perfect) shot for a given club when triggered. Deterministic given a seed. */
export class SimulatedShotSource extends BaseShotSource {
  readonly id = "simulated";
  readonly label = "Simulated";
  readonly seed: number;
  readonly fidelity: ShotFidelity;

  private dispersion: DispersionParams;
  private rng: () => number;
  private lastTrue: RawShotEvent | null = null;

  constructor(options: SimulatedShotSourceOptions = {}) {
    super();
    this.dispersion = options.dispersion ?? DEFAULT_DISPERSION;
    this.seed = options.seed ?? Date.now();
    this.fidelity = options.fidelity ?? "device";
    this.rng = mulberry32(this.seed);
  }

  /**
   * `swingFraction` (default: full) scales the club's ball speed/spin/launch
   * and tightens dispersion for a partial swing -- see `scaleClubForSwing`.
   * The device never measures swing intent, only what happened, so this
   * only shapes what SimulatedShotSource generates; it has no analog on
   * ManualShotSource or RawShotEvent.
   *
   * `carryAdjustPct` (default: 0) is a per-club bag-editing correction
   * (Part C) -- scales ball speed the same way a partial swing does, just
   * from a persisted per-club setting instead of a per-shot slider. Applied
   * to the club preset BEFORE swingFraction scaling, so the two compose
   * (a player who's set their driver +5% still gets that correction on a
   * partial-swing wedge too).
   */
  hit(
    clubId: ClubId,
    timestamp: number = Date.now(),
    swingFraction: number = FULL_SWING_FRACTION,
    carryAdjustPct: number = 0,
  ): RawShotEvent {
    this.requireStarted("hit a shot");
    const presetClub = findClub(clubId);
    const baseClub = carryAdjustPct === 0 ? presetClub : { ...presetClub, ballSpeedMph: presetClub.ballSpeedMph * (1 + carryAdjustPct / 100) };
    const club = swingFraction === FULL_SWING_FRACTION ? baseClub : scaleClubForSwing(baseClub, swingFraction);
    const dispersion =
      swingFraction === FULL_SWING_FRACTION ? this.dispersion : scaleDispersionForSwing(this.dispersion, swingFraction);
    const trueShot = simulateShot(club, dispersion, this.rng, timestamp);
    this.lastTrue = trueShot;

    const emitted: RawShotEvent =
      this.fidelity === "device"
        ? { ballSpeedMph: trueShot.ballSpeedMph, launchDeg: trueShot.launchDeg, timestamp: trueShot.timestamp }
        : trueShot;

    this.emit(emitted);
    return emitted;
  }

  /**
   * The fully-generated shot behind the most recent hit(), including
   * whatever 'device' fidelity withheld from the emitted RawShotEvent.
   * Lets us measure how much error enrichShot's spin/axis/start-line
   * estimates introduce versus the ground truth we actually simulated.
   */
  getLastTrueShot(): RawShotEvent | null {
    return this.lastTrue;
  }

  /** Swaps the dispersion model live -- e.g. the player changes skill profile mid-session. Takes effect on the next hit(). */
  setDispersion(dispersion: DispersionParams): void {
    this.dispersion = dispersion;
  }
}
