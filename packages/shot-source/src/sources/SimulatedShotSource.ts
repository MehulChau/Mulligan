import { findClub, type ClubId } from "../clubs";
import { DEFAULT_DISPERSION, simulateShot, type DispersionParams } from "../dispersion";
import { mulberry32 } from "../rng";
import type { RawShotEvent } from "../types";
import { BaseShotSource } from "./ShotSource";

/** Emits a plausible (not perfect) shot for a given club when triggered. Deterministic given a seed. */
export class SimulatedShotSource extends BaseShotSource {
  readonly id = "simulated";
  readonly label = "Simulated";
  readonly seed: number;

  private rng: () => number;

  constructor(
    private dispersion: DispersionParams = DEFAULT_DISPERSION,
    seed: number = Date.now(),
  ) {
    super();
    this.seed = seed;
    this.rng = mulberry32(seed);
  }

  hit(clubId: ClubId, timestamp: number = Date.now()): RawShotEvent {
    this.requireStarted("hit a shot");
    const club = findClub(clubId);
    const shot = simulateShot(club, this.dispersion, this.rng, timestamp);
    this.emit(shot);
    return shot;
  }
}
