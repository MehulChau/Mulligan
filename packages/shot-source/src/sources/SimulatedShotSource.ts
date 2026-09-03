import { findClub, type ClubId } from "../clubs";
import { DEFAULT_DISPERSION, simulateShot, type DispersionParams } from "../dispersion";
import { mulberry32 } from "../rng";
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

  hit(clubId: ClubId, timestamp: number = Date.now()): RawShotEvent {
    this.requireStarted("hit a shot");
    const club = findClub(clubId);
    const trueShot = simulateShot(club, this.dispersion, this.rng, timestamp);
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
}
