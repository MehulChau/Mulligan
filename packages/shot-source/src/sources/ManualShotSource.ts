import type { RawShotEvent } from "../types";
import { BaseShotSource } from "./ShotSource";

/** Emits a RawShotEvent when given explicit numbers — for testing, and for typing in a real launch monitor reading later. */
export class ManualShotSource extends BaseShotSource {
  readonly id = "manual";
  readonly label = "Manual entry";

  emit(shot: RawShotEvent): void {
    this.requireStarted("emit a shot");
    super.emit(shot);
  }
}
