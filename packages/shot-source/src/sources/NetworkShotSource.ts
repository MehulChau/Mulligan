import type { RawShotEvent, ShotField } from "../types";
import { BaseShotSource } from "./ShotSource";

/**
 * The subset of the standard `WebSocket` interface this file needs. Not an
 * npm dependency -- both browsers and modern Node (v22+) expose a global
 * `WebSocket` client that satisfies this shape, so the default factory
 * below just reaches for `globalThis.WebSocket`. Declaring our own minimal
 * interface (rather than pulling in `"dom"` for the whole package, or
 * depending on `@types/node`'s ambient global which not every version
 * declares) keeps this package's "no browser APIs" boundary intentional --
 * WebSocket is a runtime-agnostic transport, not a DOM API, and this type
 * says exactly that and nothing more.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Builds the socket for a given URL. Overridable so tests can inject a fake without a real server. */
export type WebSocketFactory = (url: string) => WebSocketLike;

function defaultWebSocketFactory(url: string): WebSocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!Ctor) {
    throw new Error("NetworkShotSource: no global WebSocket constructor available in this runtime");
  }
  return new Ctor(url);
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ProtocolVersion {
  major: number;
  minor: number;
}

/** The one major version this client understands. See docs/device-protocol.md's versioning rule. */
const SUPPORTED_MAJOR_VERSION = 1;

export interface DeviceInfo {
  deviceId: string;
  firmwareVersion: string;
  protocolVersion: ProtocolVersion;
  capabilities: ShotField[];
}

export interface DeviceStatus {
  ready: boolean;
  detail?: string;
}

// Generous, NOT derived from real mishits -- see docs/device-protocol.md's
// "Validation bounds" section for why these specific numbers and what
// should replace them once a real range session exists.
const BOUNDS: Record<string, [number, number]> = {
  ballSpeedMph: [20, 220],
  launchDeg: [-10, 60],
  spinRpm: [0, 12000],
  spinAxisDeg: [-45, 45],
  startLineDeg: [-45, 45],
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function inBounds(field: keyof typeof BOUNDS, value: number): boolean {
  const [min, max] = BOUNDS[field]!;
  return value >= min && value <= max;
}

/** Validates a decoded `shot` message into a RawShotEvent, or returns null with a logged reason. Never throws. */
function validateShotPayload(payload: Record<string, unknown>, log: (msg: string) => void): (RawShotEvent & { seq: number }) | null {
  const { seq, ballSpeedMph, launchDeg, timestamp, startLineDeg, spinRpm, spinAxisDeg } = payload;

  if (!isFiniteNumber(seq)) {
    log("shot rejected: seq missing or not a finite number");
    return null;
  }
  if (!isFiniteNumber(ballSpeedMph) || !inBounds("ballSpeedMph", ballSpeedMph)) {
    log(`shot rejected: ballSpeedMph invalid (${JSON.stringify(ballSpeedMph)})`);
    return null;
  }
  if (!isFiniteNumber(launchDeg) || !inBounds("launchDeg", launchDeg)) {
    log(`shot rejected: launchDeg invalid (${JSON.stringify(launchDeg)})`);
    return null;
  }
  if (!isFiniteNumber(timestamp)) {
    log("shot rejected: timestamp missing or not a finite number");
    return null;
  }
  if (startLineDeg !== undefined && (!isFiniteNumber(startLineDeg) || !inBounds("startLineDeg", startLineDeg))) {
    log(`shot rejected: startLineDeg invalid (${JSON.stringify(startLineDeg)})`);
    return null;
  }
  if (spinRpm !== undefined && (!isFiniteNumber(spinRpm) || !inBounds("spinRpm", spinRpm))) {
    log(`shot rejected: spinRpm invalid (${JSON.stringify(spinRpm)})`);
    return null;
  }
  if (spinAxisDeg !== undefined && (!isFiniteNumber(spinAxisDeg) || !inBounds("spinAxisDeg", spinAxisDeg))) {
    log(`shot rejected: spinAxisDeg invalid (${JSON.stringify(spinAxisDeg)})`);
    return null;
  }

  return {
    seq,
    ballSpeedMph,
    launchDeg,
    timestamp,
    ...(startLineDeg !== undefined ? { startLineDeg } : {}),
    ...(spinRpm !== undefined ? { spinRpm } : {}),
    ...(spinAxisDeg !== undefined ? { spinAxisDeg } : {}),
  };
}

export interface NetworkShotSourceOptions {
  url: string;
  /** Reconnect with backoff after a drop. Default true -- a range session must survive a WiFi hiccup. */
  reconnect?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  /** Injects a fake socket in place of the real WebSocket constructor -- this is what makes the class testable without a live server. */
  createSocket?: WebSocketFactory;
  /** Receives one-line diagnostic strings for dropped/rejected frames -- defaults to console.warn. */
  onLog?: (message: string) => void;
}

/**
 * Fourth `ShotSource` implementation: a real (or mock) device over
 * WebSocket, per docs/device-protocol.md. Unlike the three in-process
 * fakes it joins, this one is genuinely asynchronous and stateful --
 * connection can drop and come back at any time, independent of anything
 * the game does -- so it exposes connection state and device info as
 * separate subscribable channels on top of the plain `ShotSource`
 * interface (`onShot` alone isn't enough to build a "Device" UI panel
 * around).
 */
export class NetworkShotSource extends BaseShotSource {
  readonly id = "network";
  readonly label = "Device";

  private readonly url: string;
  private readonly reconnectEnabled: boolean;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly createSocket: WebSocketFactory;
  private readonly log: (message: string) => void;

  private socket: WebSocketLike | null = null;
  private connectionState: ConnectionState = "disconnected";
  private deviceInfo: DeviceInfo | null = null;
  private lastStatus: DeviceStatus | null = null;
  private lastSeq = -1;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPingNonce: string | null = null;
  private stoppedByCaller = false;
  private intentionalClose = false;

  private connectionListeners = new Set<(state: ConnectionState) => void>();
  private deviceInfoListeners = new Set<(info: DeviceInfo) => void>();
  private statusListeners = new Set<(status: DeviceStatus) => void>();

  constructor(options: NetworkShotSourceOptions) {
    super();
    this.url = options.url;
    this.reconnectEnabled = options.reconnect ?? true;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 10_000;
    this.pingIntervalMs = options.pingIntervalMs ?? 15_000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 5_000;
    this.createSocket = options.createSocket ?? defaultWebSocketFactory;
    this.log = options.onLog ?? ((message) => console.warn(`[NetworkShotSource] ${message}`));
  }

  override async start(): Promise<void> {
    await super.start();
    this.stoppedByCaller = false;
    // A fresh player-initiated session resets dedup tracking. This does
    // NOT distinguish a genuine device reboot mid-session from a normal
    // reconnect -- see docs/device-protocol.md's "Known gaps" section.
    this.lastSeq = -1;
    this.reconnectAttempt = 0;
    this.connect();
  }

  override stop(): void {
    this.stoppedByCaller = true;
    this.clearTimers();
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }
    this.setConnectionState("disconnected");
    super.stop();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  onConnectionStateChange(cb: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(cb);
    return () => this.connectionListeners.delete(cb);
  }

  getDeviceInfo(): DeviceInfo | null {
    return this.deviceInfo;
  }

  onDeviceInfo(cb: (info: DeviceInfo) => void): () => void {
    this.deviceInfoListeners.add(cb);
    return () => this.deviceInfoListeners.delete(cb);
  }

  getLastStatus(): DeviceStatus | null {
    return this.lastStatus;
  }

  onStatus(cb: (status: DeviceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const cb of this.connectionListeners) cb(state);
  }

  private connect(): void {
    this.setConnectionState("connecting");
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.url);
    } catch (err) {
      this.log(`failed to create socket: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      // "connected" is set on a valid `hello`, not on socket-open -- see
      // the class doc comment. Nothing to do here but wait for it.
    };

    socket.onmessage = (event) => this.handleMessage(event.data);

    socket.onclose = () => {
      this.socket = null;
      this.clearTimers();
      if (this.stoppedByCaller) return;
      if (this.intentionalClose) {
        // We closed this socket ourselves for a reason that already set
        // its own terminal state (currently: protocol version mismatch) --
        // the generic disconnected/reconnect path must not run on top of
        // that, or a deliberate "don't retry" turns back into a retry.
        this.intentionalClose = false;
        return;
      }
      this.setConnectionState("disconnected");
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // A WebSocket "error" event carries no useful detail and is always
      // followed by a close event -- onclose is where reconnect actually
      // gets scheduled. This handler exists only so an unhandled-error
      // path can never crash the caller.
    };
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.stoppedByCaller) {
      this.setConnectionState(this.reconnectEnabled ? "disconnected" : "error");
      return;
    }
    const delay = Math.min(this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt, this.reconnectMaxDelayMs);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.stoppedByCaller) this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pongTimeoutTimer = null;
  }

  private startLiveness(): void {
    this.pingTimer = setInterval(() => this.sendPing(), this.pingIntervalMs);
  }

  private sendPing(): void {
    if (!this.socket) return;
    const nonce = Math.random().toString(36).slice(2);
    this.pendingPingNonce = nonce;
    this.socket.send(JSON.stringify({ type: "ping", nonce }));
    this.pongTimeoutTimer = setTimeout(() => {
      this.log("pong timeout -- treating connection as dead");
      this.socket?.close();
    }, this.pongTimeoutMs);
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      this.log("dropped a frame: not valid JSON");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      this.log("dropped a frame: missing type field");
      return;
    }
    const message = parsed as Record<string, unknown>;

    switch (message.type) {
      case "hello":
        this.handleHello(message);
        return;
      case "shot":
        this.handleShot(message);
        return;
      case "status":
        this.handleStatus(message);
        return;
      case "ping":
        if (typeof message.nonce === "string" && this.socket) {
          this.socket.send(JSON.stringify({ type: "pong", nonce: message.nonce }));
        }
        return;
      case "pong":
        if (message.nonce === this.pendingPingNonce) {
          if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
          this.pendingPingNonce = null;
        }
        return;
      default:
        // Unknown message type within a known protocol version -- ignore,
        // per the compatibility rule in docs/device-protocol.md.
        return;
    }
  }

  private handleHello(message: Record<string, unknown>): void {
    const version = message.protocolVersion as ProtocolVersion | undefined;
    if (!version || typeof version.major !== "number") {
      this.log("hello rejected: missing/invalid protocolVersion");
      return;
    }
    if (version.major !== SUPPORTED_MAJOR_VERSION) {
      this.log(`incompatible protocol major version ${version.major} (this client supports ${SUPPORTED_MAJOR_VERSION}) -- not retrying`);
      this.reconnectAttempt = 0;
      this.intentionalClose = true;
      this.socket?.close();
      this.setConnectionState("error");
      return;
    }

    const info: DeviceInfo = {
      deviceId: typeof message.deviceId === "string" ? message.deviceId : "unknown",
      firmwareVersion: typeof message.firmwareVersion === "string" ? message.firmwareVersion : "unknown",
      protocolVersion: version,
      capabilities: Array.isArray(message.capabilities) ? (message.capabilities as ShotField[]) : [],
    };
    this.deviceInfo = info;
    for (const cb of this.deviceInfoListeners) cb(info);

    this.reconnectAttempt = 0;
    this.setConnectionState("connected");
    this.startLiveness();
  }

  private handleShot(message: Record<string, unknown>): void {
    const shot = validateShotPayload(message, this.log);
    if (!shot) return;

    if (shot.seq <= this.lastSeq) {
      this.log(`dropped duplicate/out-of-order shot (seq ${shot.seq}, last seen ${this.lastSeq})`);
      return;
    }
    this.lastSeq = shot.seq;

    const { seq: _seq, ...rawShotEvent } = shot;
    this.emit(rawShotEvent);
  }

  private handleStatus(message: Record<string, unknown>): void {
    const status: DeviceStatus = {
      ready: message.ready === true,
      ...(typeof message.detail === "string" ? { detail: message.detail } : {}),
    };
    this.lastStatus = status;
    for (const cb of this.statusListeners) cb(status);
  }
}
