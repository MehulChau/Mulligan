# Device protocol (v1)

The contract between the Raspberry Pi (device) and the phone app. Precise
enough that the device side should be implementable from this document
alone, without reading the app's source. If you're implementing the Pi and
something here is ambiguous, that's a bug in this document — see the "Known
gaps" section at the bottom for the ones already found.

## Transport: WebSocket, device is the server

**The Pi runs a WebSocket server. The app is a WebSocket client that
connects to it.** That's the right way round, not the other way:

- The Pi sits on a fixed local address (`mulligan.local` via mDNS, or a
  static IP) and stays powered on and running for the whole range
  session. The phone is the thing that comes and goes — it sleeps, the
  screen locks, the player walks to a different bay.
- A server needs a stable place to listen. The Pi is that place. The phone
  is not — it doesn't have a fixed address most WiFi networks will resolve,
  and it can't run a server while asleep.
- So: app connects out to the device, not the other way around.

**Why WebSocket and not BLE:** shots are infrequent (one every 20-30
seconds) and small (a few hundred bytes of JSON), which sounds like a
BLE use case at first glance. But the connection needs to stay alive
across a 45-minute range session, survive the phone's screen locking, and
reconnect cleanly after a WiFi hiccup — and BLE adds pairing friction and
MTU/fragmentation handling for payloads this small that WiFi just doesn't
have. The Pi already needs WiFi for setup/debugging (SSH, VNC), so running
the shot transport over the same network is close to free. BLE remains
possible later — `ShotSource` is the abstraction boundary, and a
`BleShotSource` would implement the exact same interface `NetworkShotSource`
does. Nothing in the game or the UI would need to change.

## Versioning

Every `hello` message carries a `protocolVersion: { major: number, minor:
number }`.

- **The app refuses to use a connection whose `major` it doesn't
  recognize.** It stays connected only long enough to log the mismatch and
  surface it to the player as an error state — it does not retry, since
  retrying against an incompatible major version will never succeed.
- **The app ignores fields it doesn't recognize within a known major
  version.** A minor version bump may add new optional fields to any
  message; a client built against an earlier minor version must not choke
  on messages containing them. This document only ever adds fields on a
  minor bump — a `major` bump is reserved for changes that remove or
  redefine an existing field's meaning.

This document specifies **v1.0**.

## Messages

All messages are single-line JSON objects, one per WebSocket text frame.
Every message has a `type` field.

### `hello` — device → app, once, immediately on connect

```json
{
  "type": "hello",
  "protocolVersion": { "major": 1, "minor": 0 },
  "deviceId": "mulligan-pi-01",
  "firmwareVersion": "0.3.1",
  "capabilities": ["ballSpeed", "launch"]
}
```

- `capabilities` is a list drawn from the same five fields
  `RawShotEvent`/`ShotEvent` provenance already uses: `"ballSpeed"`,
  `"launch"`, `"spin"`, `"spinAxis"`, `"startLine"`. It states which fields
  this specific device can actually measure — **not** which fields the
  protocol supports. The v1 hardware advertises `["ballSpeed", "launch"]`
  only. When real spin measurement ships (the v2+ stretch goal
  `CLAUDE.md` describes), the device firmware update is the only thing
  that changes — it starts advertising `"spin"` too, and the app's
  provenance display picks that up automatically, because the app never
  hardcodes an assumption about what a given hardware generation can do.
  It reads the capability list.
- This is why capabilities matter for honesty, not just feature-gating:
  without it, the app would have to guess whether a missing
  `spinRpm` on a given `shot` message means "this device can't measure
  spin" or "this device can measure spin but missed this one swing" — and
  those two cases must be labeled differently (`estimated` vs a
  measurement gap) or the provenance badges lie.

### `shot` — device → app, one per swing

```json
{
  "type": "shot",
  "seq": 42,
  "ballSpeedMph": 87.3,
  "launchDeg": 24.1,
  "timestamp": 1757000000000,
  "startLineDeg": 1.2,
  "spinRpm": 8900,
  "spinAxisDeg": -3.5
}
```

- `seq` is a **monotonically increasing, per-device-boot** integer,
  starting at 0 (or 1 — the app does not require a specific start value,
  only that it strictly increases). It exists so the app can detect and
  drop a duplicate delivery after a reconnect.
- Every field after `timestamp` is optional, exactly like `RawShotEvent`.
  **Only send a field the device actually measured on this swing.** If
  `capabilities` didn't advertise a field, never send it — see "What the
  device must never send" below.
- `ballSpeedMph`, `launchDeg`, and `timestamp` are the only fields that are
  ever required.
- `startLineDeg`/`spinAxisDeg` are relative to the device's own physical
  mounting angle, not the player's chosen aim line. See "Aim zeroing lives
  entirely in the app" below — this is a deliberate, load-bearing
  distinction.

### `status` — device → app, periodic (recommended: every 2-5s, and immediately on any change)

```json
{ "type": "status", "ready": true }
```

```json
{ "type": "status", "ready": false, "detail": "camera not calibrated" }
```

- `ready` is the one field the app treats as structured (it gates whether
  the UI tells the player they can swing). `detail`, when present, is a
  free-text string shown to the player as-is — camera not calibrated,
  strobe fault, ball not detected at the tee mark, whatever the device
  wants to surface. The app does not parse `detail` for meaning.

### `ping` / `pong` — either direction, liveness

```json
{ "type": "ping", "nonce": "a1b2c3" }
```

```json
{ "type": "pong", "nonce": "a1b2c3" }
```

- Either side may send a `ping` at any time and must receive a matching
  `pong` (same `nonce`, echoed back exactly) within a few seconds.
- The app sends a `ping` every ~15s while connected and treats a missing
  `pong` within 5s as a dead connection — it closes the socket and starts
  reconnecting. This is what catches a WiFi hiccup that never sends a
  proper TCP close.
- The device is free to do the same in the other direction (ping the app
  to confirm it's still there) but nothing in v1 depends on it.

## What the device must never send

This restates the M0 measurement boundary explicitly, because it's the
thing most likely to erode over time as hardware gets better and it
becomes tempting to have the device "just compute" something useful:

**The device sends only what it physically measured: `ballSpeedMph`,
`launchDeg`, `timestamp`, and — only if it actually has the hardware for
it — `startLineDeg`, `spinRpm`, `spinAxisDeg`.**

It never sends: `clubId` (the device doesn't know which club you hit —
you selected that in the app), `swingFraction` (a game/UI concept, not a
measurement), `carryYds`/`apexFt`/any flight prediction (that's
`@mulligan/physics`'s job, run from measured launch conditions — the
device does not have the aero model and must not approximate one), or a
value for a field it derived rather than measured for a field it also
lacks the hardware to measure.

The reason this matters more than it sounds like it should: **a value the
device computed but didn't measure is a lie the app cannot distinguish
from a real measurement.** The whole provenance system —
`ShotEvent.provenance`, the measured/estimated badges in the HUD, the
calibration harness's trust in `MEASUREMENTS` — depends on "present on the
wire" meaning "measured." If a device ever sends a value it back-computed
to seem more complete, every one of those depends on that lie without any
way to catch it. `enrichShot()` already knows how to estimate a missing
field and mark it `estimated` — that's where estimation belongs, in the
app, in the open, not on the device pretending to have measured something
it didn't.

## Aim zeroing lives entirely in the app

The device knows nothing about the hole, the pin, or which way the player
is aiming. It reports `startLineDeg`/`spinAxisDeg` relative to **its own
fixed physical mounting angle** — whatever "straight ahead" means to a
camera bolted to a stand next to the mat. It never changes this
reference, ever, regardless of what the player does in the app.

The app is the only thing that knows where the pin is. Once per session
(and again any time the player changes bays or feels the zero has
drifted), the player points at a fixed physical target and taps to set
it as zero. The app stores that as `sessionZeroDeg` and subtracts it from
every subsequent `startLineDeg`/`spinAxisDeg` before treating them as
"relative to the player's aim." See `AimZeroPanel`/`gameState.ts` in
`apps/web` for the implementation — none of this reaches the device, and
none of it is part of this protocol.

## Validation bounds (placeholder — replace after a real range session)

Before emitting a `shot` message as a `RawShotEvent`, the app checks that
every present numeric field is finite and inside a generous bound. These
bounds are **not derived from real mishits** — they're carried over from
the manual-entry UI's slider ranges (`ManualEntryPanel.tsx`), which were
themselves chosen during M0/M1 to be NaN-safe for the physics integrator,
not to describe what a real bad swing looks like. Widened slightly beyond
the UI sliders since a real launch monitor sees uglier outliers than a
slider ever will:

| field | bound |
|---|---|
| `ballSpeedMph` | 20 – 220 |
| `launchDeg` | -10 – 60 |
| `spinRpm` | 0 – 12000 |
| `spinAxisDeg` | -45 – 45 |
| `startLineDeg` | -45 – 45 |

A message failing this check is dropped and logged — the connection stays
up, the round continues, nothing crashes. **Replace this table with real
numbers once the range session in `docs/range-session.md` has produced a
sense of what an actual bad mishit's launch monitor reading looks like.**

## The mock device (`tools/mock-device.ts`)

`npm run mock-device` starts a WebSocket server on `ws://localhost:8080`
that speaks exactly this protocol from the device side, advertising only
`["ballSpeed", "launch"]` — matching the real v1 hardware. It's built to
be driven interactively from the terminal it runs in:

- Press `Enter` (or `s`) to emit one shot with plausible random numbers.
- Press `n`/`N` to toggle "emit a shot every N seconds" auto-fire mode, for
  soak-testing a connection over a long stretch without touching the
  keyboard.
- Press `m` to enter misbehavior mode, which cycles through: sending
  malformed (non-JSON) frames, resending the previous `seq` (a duplicate),
  sending an out-of-range value, and dropping the connection outright
  (closing the socket without a close handshake, to simulate a WiFi
  hiccup rather than a clean disconnect).
- Press `q` to quit.

**The loop, end to end:**

```
# terminal 1
npm run mock-device

# terminal 2
npm run dev
# in the app: Source -> Device, address ws://localhost:8080, tap Connect
```

Once connected, pressing a key in terminal 1 puts a ball in the air on the
hole in terminal 2's browser tab. Killing terminal 1 mid-round should show
a clear "disconnected" state in the app without ending the round; starting
it again should reconnect automatically.

**This mock is not throwaway.** It is the thing you run first when the
real Pi does something the app doesn't expect — if the mock behaves and
the Pi doesn't, the bug is in the Pi; if the mock also reproduces it, the
bug is in the app.

## Known gaps (found while implementing the app side)

Honest list of the places this document is underspecified — these are
exactly the spots a real Pi implementation is likely to disagree with the
app about, because the app had to guess.

- **Sequence numbers and device reboots.** `seq` is specified as
  monotonically increasing "per device boot," but nothing in `hello`
  identifies *which* boot a connection belongs to. If the Pi loses power
  mid-round and reboots, its `seq` counter resets to 0/1 while the app's
  dedup tracker still remembers a much higher `seq` from before the
  reboot — every shot after a mid-round reboot would be silently dropped
  as a false duplicate. `NetworkShotSource` as implemented does not solve
  this; it just resets its dedup tracker when the *player* restarts the
  app's connection (`start()`), not when the device reboots, because there
  is currently no way to tell the two apart from the wire alone. A real
  fix needs either a `bootId`/session nonce in `hello` that changes across
  reboots (so the app can key dedup on `(bootId, seq)` instead of `seq`
  alone), or a documented rule that the device must persist its `seq`
  counter across a reboot. Not fixed here — flagged for the next revision
  of this document before real hardware ships.
- **`status` cadence is a recommendation, not a rule.** "Every 2-5s" is a
  guess at something reasonable for a Pi to produce and a phone to receive
  without either spamming the link or leaving the player looking at stale
  state; there's no enforcement or negotiation of it in the protocol.
- **No message ever explicitly ends a session.** The device doesn't know
  what a "round" is (that's a game concept), so there's no `goodbye` or
  equivalent — a session just ends when the app disconnects or the socket
  drops. That's probably fine, but it means the device can't distinguish
  "player finished the round and closed the app" from "phone lost WiFi" —
  it has no way to know whether to expect a reconnect.
- **No authentication or pairing.** Anything on the local network that
  speaks this protocol can pretend to be the device. Fine for a
  single-device home/range network; would need addressing before this
  ever left a trusted local network.
