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
const AUTO_INTERVAL_SEC = Number(process.env.MOCK_DEVICE_AUTO_INTERVAL_SEC ?? 20);

const PROTOCOL_VERSION = { major: 1, minor: 0 };
const DEVICE_ID = "mock-device-01";
const FIRMWARE_VERSION = "mock-0.1.0";
// Matches the real v1 hardware exactly -- see docs/device-protocol.md.
const CAPABILITIES = ["ballSpeed", "launch"];

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
  return { type: "shot", seq: seq++, ballSpeedMph, launchDeg, timestamp: Date.now() };
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
  console.log("Keys: [Enter/s] shot   [n] toggle auto-fire   [m] misbehave   [q] quit");
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
