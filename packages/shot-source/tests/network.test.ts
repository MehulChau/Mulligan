import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkShotSource, type WebSocketLike } from "../src/sources/NetworkShotSource";
import type { RawShotEvent } from "../src/types";

/** A controllable fake WebSocket -- lets tests drive open/message/close without a real server. */
class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason });
  }

  // --- test helpers, not part of WebSocketLike ---
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  simulateRawMessage(data: string): void {
    this.onmessage?.({ data });
  }

  simulateServerClose(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "abnormal closure" });
  }

  lastSentJSON(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]!);
  }
}

const HELLO_V1 = {
  type: "hello",
  protocolVersion: { major: 1, minor: 0 },
  deviceId: "test-device",
  firmwareVersion: "0.0.1",
  capabilities: ["ballSpeed", "launch"],
};

function helloWithBoot(bootId: string): Record<string, unknown> {
  return { ...HELLO_V1, protocolVersion: { major: 1, minor: 1 }, bootId };
}

function shotMessage(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    type: "shot",
    seq: 1,
    ballSpeedMph: 90,
    launchDeg: 20,
    timestamp: 1000,
    ...overrides,
  };
}

describe("NetworkShotSource", () => {
  let sockets: FakeSocket[];
  let source: NetworkShotSource;
  let logs: string[];

  function makeSource(overrides: Partial<ConstructorParameters<typeof NetworkShotSource>[0]> = {}) {
    logs = [];
    sockets = [];
    return new NetworkShotSource({
      url: "ws://fake",
      onLog: (m) => logs.push(m),
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    source = makeSource();
  });

  afterEach(() => {
    source.stop();
    vi.useRealTimers();
  });

  it("starts disconnected, transitions to connecting on start(), connected on a valid hello", async () => {
    const states: string[] = [];
    source.onConnectionStateChange((s) => states.push(s));

    expect(source.getConnectionState()).toBe("disconnected");
    await source.start();
    expect(source.getConnectionState()).toBe("connecting");

    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage(HELLO_V1);

    expect(source.getConnectionState()).toBe("connected");
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("exposes device info (capabilities) from hello", async () => {
    const infos: unknown[] = [];
    source.onDeviceInfo((info) => infos.push(info));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);

    expect(source.getDeviceInfo()).toEqual({
      deviceId: "test-device",
      firmwareVersion: "0.0.1",
      protocolVersion: { major: 1, minor: 0 },
      capabilities: ["ballSpeed", "launch"],
    });
    expect(infos).toHaveLength(1);
  });

  it("refuses an incompatible major protocol version and does not retry", async () => {
    await source.start();
    sockets[0]!.simulateMessage({ ...HELLO_V1, protocolVersion: { major: 2, minor: 0 } });

    expect(source.getConnectionState()).toBe("error");
    expect(sockets[0]!.closed).toBe(true);

    // advancing time should NOT create a second socket -- no retry after a version mismatch
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("ignores unknown message types and unknown fields on known messages", async () => {
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    expect(() => sockets[0]!.simulateMessage({ type: "some-future-message", weird: true })).not.toThrow();
    expect(() =>
      sockets[0]!.simulateMessage({ ...shotMessage(), unexpectedExtraField: "whatever" }),
    ).not.toThrow();
    expect(source.getConnectionState()).toBe("connected");
  });

  it("emits a valid shot as a RawShotEvent, stripping seq", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateMessage(shotMessage({ seq: 5, startLineDeg: 1.5 }));

    expect(received).toEqual([{ ballSpeedMph: 90, launchDeg: 20, timestamp: 1000, startLineDeg: 1.5 }]);
  });

  it("rejects a malformed (non-JSON) frame without crashing or emitting", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);

    expect(() => sockets[0]!.simulateRawMessage("{not valid json")).not.toThrow();
    expect(received).toHaveLength(0);
    expect(logs.some((l) => l.includes("not valid JSON"))).toBe(true);
    expect(source.getConnectionState()).toBe("connected");
  });

  it("rejects an out-of-range value without crashing or emitting, connection stays up", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateMessage(shotMessage({ ballSpeedMph: 9999 }));

    expect(received).toHaveLength(0);
    expect(source.getConnectionState()).toBe("connected");
  });

  it("rejects a shot with a missing required field", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    const { launchDeg: _drop, ...withoutLaunch } = shotMessage();
    sockets[0]!.simulateMessage(withoutLaunch);

    expect(received).toHaveLength(0);
  });

  it("deduplicates a resent sequence number, never emitting the same swing twice", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateMessage(shotMessage({ seq: 1 }));
    sockets[0]!.simulateMessage(shotMessage({ seq: 1 })); // resend
    sockets[0]!.simulateMessage(shotMessage({ seq: 1 })); // resend again

    expect(received).toHaveLength(1);
  });

  it("rejects an out-of-order (lower) sequence number as a duplicate", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateMessage(shotMessage({ seq: 5 }));
    sockets[0]!.simulateMessage(shotMessage({ seq: 3 }));

    expect(received).toHaveLength(1);
  });

  it("without a bootId (a v1.0 device), falls back to seq-only dedup and logs the fallback exactly once", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1); // no bootId
    sockets[0]!.simulateMessage(shotMessage({ seq: 1 }));

    expect(received).toHaveLength(1);
    expect(logs.filter((l) => l.includes("did not send hello.bootId"))).toHaveLength(1);

    // a second hello (e.g. a plain reconnect) with the same absence of bootId must not re-log
    sockets[0]!.simulateMessage(HELLO_V1);
    expect(logs.filter((l) => l.includes("did not send hello.bootId"))).toHaveLength(1);
  });

  it("exposes bootId on DeviceInfo when the device sends one", async () => {
    await source.start();
    sockets[0]!.simulateMessage(helloWithBoot("boot-1"));
    expect(source.getDeviceInfo()?.bootId).toBe("boot-1");
  });

  it("a hello with a new bootId resets dedup -- a genuine reboot, not a resend, even without a reconnect", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();

    sockets[0]!.simulateMessage(helloWithBoot("boot-1"));
    sockets[0]!.simulateMessage(shotMessage({ seq: 5 }));
    expect(received).toHaveLength(1);

    // device reboots without the connection ever dropping: new bootId, seq restarts at 0
    sockets[0]!.simulateMessage(helloWithBoot("boot-2"));
    sockets[0]!.simulateMessage(shotMessage({ seq: 0 }));
    expect(received).toHaveLength(2); // NOT dropped as a duplicate/out-of-order relative to seq 5

    // but a genuine duplicate within the new boot is still dropped
    sockets[0]!.simulateMessage(shotMessage({ seq: 0 }));
    expect(received).toHaveLength(2);
  });

  it("a hello repeating the same bootId (a plain reconnect) does NOT reset dedup", async () => {
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));
    await source.start();

    sockets[0]!.simulateMessage(helloWithBoot("boot-1"));
    sockets[0]!.simulateMessage(shotMessage({ seq: 5 }));
    expect(received).toHaveLength(1);

    // same device, same boot, hello repeated (as if the socket briefly reconnected)
    sockets[0]!.simulateMessage(helloWithBoot("boot-1"));
    sockets[0]!.simulateMessage(shotMessage({ seq: 5 })); // a resend of the same shot
    expect(received).toHaveLength(1);
  });

  it("surfaces status messages", async () => {
    const statuses: unknown[] = [];
    source.onStatus((s) => statuses.push(s));
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateMessage({ type: "status", ready: false, detail: "camera not calibrated" });

    expect(source.getLastStatus()).toEqual({ ready: false, detail: "camera not calibrated" });
    expect(statuses).toHaveLength(1);
  });

  it("answers a device-initiated ping with a pong echoing the nonce", async () => {
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateMessage({ type: "ping", nonce: "abc123" });

    expect(sockets[0]!.lastSentJSON()).toEqual({ type: "pong", nonce: "abc123" });
  });

  it("reconnects with backoff after the connection drops, and dedup state persists across the reconnect", async () => {
    const states: string[] = [];
    source.onConnectionStateChange((s) => states.push(s));
    const received: RawShotEvent[] = [];
    source.onShot((s) => received.push(s));

    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateMessage(shotMessage({ seq: 1 }));

    sockets[0]!.simulateServerClose();
    expect(source.getConnectionState()).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);

    sockets[1]!.simulateOpen();
    sockets[1]!.simulateMessage(HELLO_V1);
    expect(source.getConnectionState()).toBe("connected");

    // device resends the same shot after reconnecting -- must not double-count
    sockets[1]!.simulateMessage(shotMessage({ seq: 1 }));
    expect(received).toHaveLength(1);

    // a genuinely new shot after reconnect still comes through
    sockets[1]!.simulateMessage(shotMessage({ seq: 2 }));
    expect(received).toHaveLength(2);
  });

  it("does not reconnect when constructed with reconnect: false", async () => {
    source = makeSource({ reconnect: false });
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    sockets[0]!.simulateServerClose();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(source.getConnectionState()).toBe("error");
  });

  it("closes the connection and stops reconnecting when stop() is called", async () => {
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);
    source.stop();
    expect(source.getConnectionState()).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("treats a missed pong as a dead connection and reconnects", async () => {
    await source.start();
    sockets[0]!.simulateMessage(HELLO_V1);

    await vi.advanceTimersByTimeAsync(15_000); // triggers the first ping
    expect(sockets[0]!.lastSentJSON().type).toBe("ping");

    await vi.advanceTimersByTimeAsync(5_000); // pong timeout, no pong ever arrived
    expect(sockets[0]!.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(1000); // reconnect backoff
    expect(sockets).toHaveLength(2);
  });
});
