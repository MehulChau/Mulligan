import type { RawShotEvent } from "../types";

/**
 * The interface the hardware will eventually implement. Exists now with no
 * hardware anywhere near it — ManualShotSource, SimulatedShotSource, and
 * ReplayShotSource are all fakes standing in for it.
 */
export interface ShotSource {
  readonly id: string;
  readonly label: string; // shown in the UI
  start(): Promise<void>;
  stop(): void;
  /** Registers a listener; call the returned function to unsubscribe. */
  onShot(cb: (shot: RawShotEvent) => void): () => void;
}

/** Shared listener bookkeeping for every ShotSource implementation below. */
export abstract class BaseShotSource implements ShotSource {
  abstract readonly id: string;
  abstract readonly label: string;

  protected started = false;
  private listeners = new Set<(shot: RawShotEvent) => void>();

  async start(): Promise<void> {
    this.started = true;
  }

  stop(): void {
    this.started = false;
  }

  onShot(cb: (shot: RawShotEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected requireStarted(action: string): void {
    if (!this.started) {
      throw new Error(`${this.id}: cannot ${action} before start()`);
    }
  }

  protected emit(shot: RawShotEvent): void {
    for (const cb of this.listeners) cb(shot);
  }
}
