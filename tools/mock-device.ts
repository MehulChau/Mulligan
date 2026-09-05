/**
 * Stands in for the Pi. Speaks exactly docs/device-protocol.md from the
 * device side, driven interactively from this terminal. This is not
 * throwaway: once the real Pi exists, this is what you run first when
 * something looks wrong -- if the mock behaves and the Pi doesn't, the bug
 * is in the Pi; if the mock reproduces it too, the bug is in the app.
 *
 * Run: npm run mock-device
 * Keys: [Enter/s] shot   [n] toggle auto-fire   [m] misbehave   [q] quit
 */
import readline from "node:readline";
import { WebSocketServer, type WebSocket as WsClient } from "ws";

const PORT = Number(process.env.MOCK_DEVICE_PORT ?? 8080);

/**
 * Set MOCK_DEVICE_AUTOSTART_SEC to start auto-fire immediately at that
 * interval, with no keypress. This is the only way to drive the mock at
 * all in a headless/non-TTY environment (CI, a scripted verification) --
 * keypress control requires a real terminal.
 */
const AUTOSTART_AUTO_FIRE = process.env.MOCK_DEVICE_AUTOSTART_SEC !== undefined;
const AUTO_INTERVAL_SEC = Number(process.env.MOCK_DEVICE_AUTOSTART_SEC ?? process.env.MOCK_DEVICE_AUTO_INTERVAL_SEC ?? 20);

/**
 * Testing-only knob, OFF by default: injects a fixed startLineDeg offset
 * into every shot, as if the device's mount were physically rotated off
 * the range's true target line. The real v1 hardware cannot measure start
 * line at all yet (see CLAUDE.md's measurement contract -- that's the
 * phone-behind-ball CV subsystem, not built), so this exists purely to let
 * the app's aim-zeroing math (docs/device-protocol.md) be exercised today,
 * ahead of the hardware that will eventually make it real. When set, this
 * mock also advertises "startLine" in capabilities, which the real v1
 * device does NOT do -- never treat this mode as representative of what
 * the real hardware currently sends.
 */
const START_LINE_OFFSET_DEG =
  process.env.MOCK_DEVICE_START_LINE_OFFSET_DEG !== undefined ? Number(process.env.MOCK_DEVICE_START_LINE_OFFSET_DEG) : null;

const PROTOCOL_VERSION = { major: 1, minor: 0 };
const DEVICE_ID = "mock-device-01";
const FIRMWARE_VERSION = "mock-0.1.0";
// Matches the real v1 hardware exactly -- see docs/device-protocol.md.
// (Widened to include "startLine" only under START_LINE_OFFSET_DEG -- see its comment above.)
const CAPABILITIES = START_LINE_OFFSET_DEG !== null ? ["ballSpeed", "launch", "startLine"] : ["ballSpeed", "launch"];

let seq = 0;
let lastShotPayload: Record<string, unknown> | null = null;
const clients = new Set<WsClient>();

function broadcast(message: Record<string, unknown>): void {
  const json = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(json);
  }
}

function randomShot(): Record<string, unknown> {
  const ballSpeedMph = Number((60 + Math.random() * 100).toFixed(1)); // 60-160mph, roughly wedge-to-driver
  const launchDeg = Number((10 + Math.random() * 25).toFixed(1)); // 10-35deg
  const shot: Record<string, unknown> = { type: "shot", seq: seq++, ballSpeedMph, launchDeg, timestamp: Date.now() };
  if (START_LINE_OFFSET_DEG !== null) {
    // Small noise on top of the fixed offset -- a real misaligned mount
    // still has shot-to-shot variation, it just never centers on zero.
    shot.startLineDeg = Number((START_LINE_OFFSET_DEG + (Math.random() - 0.5) * 2).toFixed(1));
  }
  return shot;
}

function emitShot(): void {
  const shot = randomShot();
  lastShotPayload = shot;
  broadcast(shot);
  console.log(`-> shot   seq=${shot.seq}  ballSpeed=${shot.ballSpeedMph}mph  launch=${shot.launchDeg}deg`);
}

let wss: WebSocketServer;
try {
  wss = new WebSocketServer({ port: PORT });
} catch (err) {
  console.error(`Failed to start mock device on port ${PORT}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("app connected");

  ws.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: DEVICE_ID,
      firmwareVersion: FIRMWARE_VERSION,
      capabilities: CAPABILITIES,
    }),
  );
  ws.send(JSON.stringify({ type: "status", ready: true }));

  ws.on("message", (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return; // the app can send us garbage too; a real device shouldn't crash on it either
    }
    if (typeof parsed === "object" && parsed !== null && (parsed as { type?: unknown }).type === "ping") {
      const nonce = (parsed as { nonce?: unknown }).nonce;
      ws.send(JSON.stringify({ type: "pong", nonce }));
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("app disconnected");
  });

  ws.on("error", () => {
    // Swallow -- a close event always follows, and that's where cleanup happens.
  });
});

wss.on("listening", () => {
  console.log(`Mock device listening on ws://localhost:${PORT}`);
  console.log(
    START_LINE_OFFSET_DEG !== null
      ? `Start line reporting: ON, offset ${START_LINE_OFFSET_DEG}deg (testing only -- real v1 hardware can't measure this)`
      : "Start line reporting: OFF (matches real v1 hardware)",
  );
  console.log("Keys: [Enter/s] shot   [n] toggle auto-fire   [m] misbehave   [q] quit");
  if (AUTOSTART_AUTO_FIRE) {
    console.log("MOCK_DEVICE_AUTOSTART_SEC set -- starting auto-fire immediately (no keypress available/needed)");
    toggleAuto();
  }
});

// --- keyboard control ---

let autoTimer: ReturnType<typeof setInterval> | null = null;

function toggleAuto(): void {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
    console.log("auto-fire off");
  } else {
    autoTimer = setInterval(emitShot, AUTO_INTERVAL_SEC * 1000);
    console.log(`auto-fire on: one shot every ${AUTO_INTERVAL_SEC}s (set MOCK_DEVICE_AUTO_INTERVAL_SEC to change)`);
  }
}

const MISBEHAVIORS = ["malformed", "duplicate", "out-of-range", "dropped-connection"] as const;
let misbehaviorIndex = 0;

function misbehave(): void {
  const kind = MISBEHAVIORS[misbehaviorIndex % MISBEHAVIORS.length]!;
  misbehaviorIndex += 1;

  switch (kind) {
    case "malformed":
      console.log("misbehaving: sending a malformed (non-JSON) frame");
      for (const client of clients) {
        if (client.readyState === client.OPEN) client.send("{not valid json, oops");
      }
      return;

    case "duplicate":
      if (!lastShotPayload) {
        console.log("misbehaving: no previous shot yet -- emitting one first");
        emitShot();
      }
      console.log(`misbehaving: resending the previous shot with duplicate seq=${lastShotPayload!.seq}`);
      broadcast(lastShotPayload!);
      return;

    case "out-of-range":
      console.log("misbehaving: sending an out-of-range ball speed (9999mph)");
      broadcast({ type: "shot", seq: seq++, ballSpeedMph: 9999, launchDeg: 20, timestamp: Date.now() });
      return;

    case "dropped-connection":
      console.log("misbehaving: dropping all connections without a close handshake (simulates a WiFi hiccup)");
      for (const client of clients) client.terminate();
      return;
  }
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on("keypress", (str: string | undefined, key: { ctrl?: boolean; name?: string }) => {
  if (key?.ctrl && key.name === "c") {
    process.exit(0);
  }
  switch (str) {
    case "\r":
    case "\n":
    case "s":
    case "S":
      emitShot();
      return;
    case "n":
    case "N":
      toggleAuto();
      return;
    case "m":
    case "M":
      misbehave();
      return;
    case "q":
    case "Q":
      console.log("bye");
      process.exit(0);
  }
});
