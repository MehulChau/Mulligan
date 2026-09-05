import type { ShotLog } from "../log/ShotLog";
import type { RawShotEvent } from "../types";
import { BaseShotSource } from "./ShotSource";

/** Replays a previously logged session's raw ball-flight shots back, one per next() call. Putts aren't part of this replay -- they carry no RawShotEvent. */
export class ReplayShotSource extends BaseShotSource {
  readonly id = "replay";
  readonly label: string;

  private shots: RawShotEvent[];
  private index = 0;

  constructor(log: ShotLog, sessionId: string) {
    super();
    this.shots = log
      .getSession(sessionId)
      .filter((entry) => !entry.isPutt)
      .map((entry) => entry.raw!);
    this.label = `Replay: ${sessionId}`;
  }

  override async start(): Promise<void> {
    await super.start();
    this.index = 0;
  }

  hasNext(): boolean {
    return this.index < this.shots.length;
  }

  next(): RawShotEvent | null {
    this.requireStarted("replay the next shot");
    if (!this.hasNext()) return null;
    const shot = this.shots[this.index]!;
    this.index += 1;
    this.emit(shot);
    return shot;
  }
}
