# CLAUDE.md — DIY Golf Launch Monitor + Simulator Game

## Who's building this
Mehul — new grad SWE (ex-founding engineer at a medical device startup where he built a full mobile app + on-device analytics engine solo; Google Payments intern). Strong on mobile, app architecture, and statistics. Zero hardware experience (being learned as part of this project). Plays golf, is the target user. Has an eye for design (Figma experience) — the app should look intentional, not templated.

## The vision (north star)
A cheap consumer device (~$15–30 BOM long-term) + phone app. You go to the range (or hit foam balls at home), the device measures your real swings, and you play simulated golf holes on your phone. **The range session IS the game session** — every real swing is a turn in the game. Not a stats app with a game bolted on; a game powered by real shots.

## Core architecture decision (do not revisit casually)
**Measure launch conditions in the first ~2 feet of flight; simulate everything else.**
This is how all affordable launch monitors work (vs. Trackman which tracks full flight with phased-array radar — not replicable cheaply, and not needed).

The measurement contract:
- **Ball speed** — measured by the device (camera + IR strobe multi-exposure)
- **Vertical launch angle** — measured by the device (same photo: slope of ball positions)
- **Horizontal start direction** — measured by the user's phone placed behind the ball (slow-mo video + CV). Not built yet.
- **Spin rate** — ESTIMATED from club selection + ball speed via lookup profiles (Trackman published averages). Real spin measurement (dimple rotation between strobe exposures) is a v2+ stretch goal, not a launch blocker.
- **Spin axis (draw/fade curve)** — estimated/simplified for v1.

Foam-ball mode insight: since we measure launch (not flight), foam ball launches can be scaled to what a real ball would have done → full simulated holes from living-room swings. Validate early that foam balls trigger/expose well (lighter, slower, less reflective).

## Hardware (inspired by PiTrac, open-source project — github.com/PiTracLM/PiTrac)
Single-camera v1, ~$220–250 total:
- Raspberry Pi 5 (4GB) — the brain
- Pi **Global Shutter** camera (must be global shutter — no motion distortion) + 6mm CS-mount lens
- High-power 850nm IR LED strobe + MOSFET driver (IRLZ44N), breadboarded for v0
- Laser diode (~$3) marking ball placement — known ball position massively simplifies CV
- Breadboard, jumpers, resistors, multimeter, one regular LED for testing
- Enclosure: none for v0 (breadboard on wood is fine); friend can 3D print later (PiTrac publishes enclosure files)

How it works: camera takes ONE long exposure while IR strobe fires several times → ball appears multiple times in one photo. Gap between ball images ÷ strobe interval = speed; slope of the line through them = launch angle. Device sits ~2ft to the side of the ball.

Hardware bring-up ladder (each rung independently testable):
1. Pi boots, SSH in → 2. camera takes a still → 3. laser on via GPIO → 4. MOSFET circuit blinks regular LED → 5. IR LEDs flash, camera sees it → 6. multi-exposure of a hand-rolled ball indoors → 7. real swings.
Status: parts being ordered; hardware is NOT the current workstream.

## Software architecture (4 layers)
1. **Capture & measurement** (on Pi): trigger, strobe sync, CV pipeline (find ball in each exposure → speed/angle). Build to run against static test images on a laptop, not only live camera. Not started.
2. **Shot pipeline / backend**: receives shot events, enriches (ballistics → carry/apex), persists. Data model: shots → sessions → clubs. Not started; can be local-first initially.
3. **The app / game** ← CURRENT WORKSTREAM. See below.
4. **Feature runway**: challenge modes, async multiplayer (ghost shots), daily challenge, GSPro connect API integration, shot classification, practice/proximity games.

## Current state: M1 done — one playable hole, no putting/scoring yet
The playable-hole MVP is being built in labeled milestones: **M0** (done, 2026-09-01) extracted and fixed the physics; **M1** (done, 2026-09-02) is one playable hole — pick a club, swing, watch the ball fly and come to rest, repeat until the green; **M2** is the surface-aware shot resolver (real rollout, lie penalties, putting, scoring). `tools/flight-lab.html` (moved from the repo root) is a thin UI shell that imports the built `@mulligan/physics` + `@mulligan/shot-source` modules — it carries no physics of its own. Build it with `npm run build:tools`, then serve the repo root over HTTP (`npm run tools`, http://localhost:4173/tools/flight-lab.html — ES module imports are blocked over `file://` by browsers) after any physics/club change.

Run the actual game: `npm run dev` (from repo root or `apps/web`), open the printed localhost URL. One hole, `SimulatedShotSource` stands in for hardware, skip-animation checkbox for fast iteration.

`packages/physics` (zero dependencies, SI in/out — see its `types.ts` for the coordinate-frame contract):
- Point-mass flight integration: drag + Magnus lift + gravity, semi-implicit Euler dt=0.004s (verified within 0.1% of converged; not worth a fancier integrator)
- Constants: m=0.04593kg, d=0.04267m, ρ=1.225, K=ρA/2m — named in `constants.ts`, the only place unit conversions (mph/yd/ft/deg/rpm ↔ SI) happen
- Spin ratio S=ωr/v; CL=min(0.34, 0.54·S^0.4); CD=min(0.34, 0.22+0.55·S); spin decay exp(−0.033t) — all 8 numbers live in `aero.ts` as an overridable `AeroParams`, not inline literals, so calibration is a data change, not a code change. **Still unretuned — no real range data yet.**
- Spin axis is now built in the *launch frame* (perpendicular to the aim direction), not world frame — the old code inflated side angle ~11% on any shot with a non-zero start line. Lift magnitude is scaled by sinTheta (angle between spin axis and velocity), not applied at full strength regardless of angle.
- Rollout was removed from the physics module entirely (`rollY`/`totalY` are gone). The integrator returns a complete `LandingState` (position, velocity, descent angle, remaining spin) and stops — rollout depends on the surface the ball lands on, which is M2's job, not the flight model's.
- Twelve club presets (ball speed mph / launch° / spin rpm) now live in `@mulligan/shot-source`'s `clubs.ts`, the source of truth (supersedes the shorter list this file used to carry): Driver 150/12.5/2800, 3-wood 140/13.5/3800, 5-wood 132/14.5/4400, 5-hybrid 120/16/5000, 6-iron 112/17.5/6250, 7-iron 106/18.5/7100, 8-iron 100/20.75/7850, 9-iron 94/23/8600, PW 86/26.5/9300, GW 79/28.5/9700, SW 72/31/10200, LW 66/33.5/10500.
- Golden regression values (straight-shot carry/apex/hang/descent per club) live in `packages/physics/tests/fixtures/golden.json`, not inline — they get deliberately replaced once real calibration data exists.
- Calibration harness (`@mulligan/shot-source/calibration`) is built and tested but **empty** — `MEASUREMENTS` has no real range data yet. Run `npm run calibrate` once Mehul's real gapping numbers are in; it fits `AeroParams` via a from-scratch Nelder–Mead optimizer (weighted on carry/apex/descent, descent weighted heaviest since it's what actually disambiguates the CL/CD split) and prints a before/after table — it never overwrites `DEFAULT_AERO` automatically.
- Design language: turf/scorecard aesthetic — sage background, deep fairway green, sand-amber for ball flight, Archivo typeface. Keep this direction.

The `ShotEvent` the original brief described as a single type turned out not to be achievable as one type — the device physically can't measure club or spin, so it's now split:
- `RawShotEvent` — exactly what the Pi transmits: `{ballSpeedMph, launchDeg, timestamp, startLineDeg?, spinRpm?, spinAxisDeg?}`. Everything after `timestamp` is optional because the CV/spin-estimation subsystems don't exist yet.
- `ShotEvent` — what the game consumes: the same fields, all required, plus `clubId` and a `provenance` map (`measured` vs `estimated` per field) so the UI can be honest about what's real and the calibration harness knows which shots to trust.
- `enrichShot(raw, clubId)` in `@mulligan/shot-source` fills the gap: spin defaults to the club profile's spin scaled by swing-speed ratio, spin axis and start line default to 0 (straight) until their measurement subsystems ship.

## Milestone split — M1 vs M2 (revised 2026-09-02)
The original brief lumped "the game loop" and "the surface-aware shot resolver" into one M1. That packed too much into one milestone; split as follows. The distinction that matters: **M1 proves the geometry and the seam. M2 makes it a game.**

### M1 (done): hole model, renderer, shot sources, shot placement
- **Hole data model** — holes are data, not code: a `Hole` is a JSON file (`packages/game/src/holes/*.json`) so authoring new holes never needs a code change. Hole space is its own 2D yards coordinate frame, origin at the tee, `x` lateral (+right), `y` downrange (+toward pin) — deliberately different from the physics module's frame (x downrange, y up, z lateral); the conversion between them is isolated to `localToHole`/`holeToLocal` in `packages/game/src/resolver/rotate.ts`. Surface lookup (`fairway`/`green`/`rough`/`bunker`/`water`/`tee`/`out`) is point-in-polygon (ray casting, hand-rolled, no dependency), topmost-painted-surface-wins. `HOLE_1` ("The Bend") is the one hole for this milestone: a 400-yard dogleg-right par 4.
- **`ShotSource` seam** (`packages/shot-source/src/sources/`) — the interface hardware will eventually implement (`start`/`stop`/`onShot`), with three implementations: `ManualShotSource` (explicit numbers), `SimulatedShotSource` (dispersed shots per club, seeded/deterministic via a tunable `DispersionParams`; `PERFECT_DISPERSION` gives exact-preset shots for tests), and `ReplayShotSource` (replays a logged session back). An append-only `ShotLog` (localStorage, in-memory fallback) records every raw + enriched shot and where it ended up — built now, before real hardware needs it, since a reproducible bad shot is worth a lot when debugging later.
- **`startLineDeg`/`spinAxisDeg` are relative to the player's chosen aim heading, not an absolute compass direction** — documented on `RawShotEvent`/`ShotEvent` directly. Every bay at the range points the same physical way; the player aims in the app, the device only measures deviation from that.
- **Shot placement** (`packages/game/src/resolver/resolveShot.ts`) — runs the physics simulation, rotates the result into hole space, and reports both the landing point (carry) and rest point. Rollout is `estimateRollout()` (`resolver/rollout.ts`), a deliberately isolated, surface-agnostic placeholder — not the real per-surface model; M2 replaces it in that one file. Lie is detected (`landingSurface`/`restSurface`) and shown in the HUD but does not affect the shot.
- **Renderer + loop** (`apps/web`) — plain `<canvas>`, one static fitted camera (pin at top, tee at bottom, no pan/zoom), stylized top-down (Tiger Woods GBA energy, not 3D). React (`useReducer`) owns game state; the canvas owns drawing + the ~1.2s flight animation (with a skip-animation mode for fast iteration) and a short roll-to-rest. Aim is a slider (degrees off "aimed at pin"); 12 club chips; HUD shows distance/lie/shot number/expected carry (median of `DEFAULT_DISPERSION`, not the noiseless preset) plus, for the last shot, carry/total and per-field measured-vs-estimated provenance. Reaching the green shows "on the green in N" and a **Play again** button resets the session.
- Non-goals honored: no putting, no scoring, no par tracking, no "hole complete" state beyond the green message; no lie penalties; no multiple holes/course; no persistence beyond the shot log; no wind/elevation/slope; `@mulligan/physics` was not touched and `AeroParams` was not retuned (still no real range data).
- **Manual entry mode** (2026-09-03) — a Simulated/Manual toggle above the controls. Manual swaps the club-preset-driven flow for five sliders (ball speed, launch, spin, spin axis, start line, same ranges flight-lab.html used) feeding `ManualShotSource`, so every field is provided directly (all "measured" provenance) — this is the harness for typing in real device readings once hardware exists, not just for testing. Picking a club still loads that club's preset into the sliders as a starting point.
- **Mobile hardening pass** (2026-09-03) — this is a phone app first: safe-area insets, no accidental pinch/double-tap zoom, `touch-action`/tap-highlight tuned for a game screen (no text-selection callouts, no pull-to-refresh bounce), ≥40px touch targets, `apple-mobile-web-app-*`/`mobile-web-app-capable` meta for home-screen install. Found and fixed a real layout bug in the process: the canvas had no protected minimum height, so Manual mode's five extra sliders could crush it to a sliver (yardage-mark text overlapping into an unreadable blob). Fixed by giving `.canvas-wrap` a `min-height` floor and making `.controls` scroll internally instead (Swing button stays `position: sticky` so it's always one tap away regardless of scroll position).
- **Visual/animation polish** (2026-09-03) — ball now casts a ground shadow while airborne, with the ball itself lifted and scaled toward apex height (the shadow/ball gap is what actually sells height in a top-down view); eased roll-to-rest instead of linear; fairway/tee mowing stripes, bunker stipple texture, faint 50-yard markers, a landing-vs-rest marker during rollout, and prior shots now show a rest-position dot, not just the flight line.
- **Bounds-safety fix** — a wayward shot (wide dispersion tail, or an extreme manual entry) can land outside the hole's authored `bounds`; the camera now unions those bounds with whatever must stay visible each frame (current ball position, and the full path of an in-flight shot) so the ball can never render off-canvas. Confirmed live: an out-of-bounds 9-iron correctly expanded the frame instead of vanishing.

### M2 (next): the surface-aware resolver
Real rollout per surface (driver run-out vs. wedge stop — using the `LandingState` the physics module already returns, replacing `estimateRollout`), lie affecting club availability, putting, scoring vs par, hole completion.

Handicap, challenge modes, and ghost multiplayer stay in the feature runway, after M2.

## Tech stack (decided 2026-09-01, for v1 game)
npm workspaces monorepo:
```
Mulligan/
├── packages/
│   ├── physics/       @mulligan/physics — pure TS, zero deps, the ball-flight model + calibration config
│   ├── shot-source/    @mulligan/shot-source — clubs, RawShotEvent/ShotEvent + enrichShot, the calibration harness, and (M1) SimulatedShotSource (depends on physics)
│   └── game/           @mulligan/game (M1) — hole data model, point-in-polygon surface lookup, hole JSON, shot placement (depends on physics + shot-source)
└── apps/
    └── web/            @mulligan/web — Vite + React 18 + TS, canvas rendering for the hole/ball-flight view
```
- **apps/web**: Vite + React + TypeScript, plain `<canvas>` for game rendering (no game-engine library) — matches flight-lab.html's approach, keeps deps minimal. React owns the HUD/club-picker/scorecard UI, which is the part most likely to carry over to React Native later.
- **packages/physics** and **packages/shot-source** are plain TS with no React/browser APIs — this is what lets the same math run in the web app, a future backend, and tests unchanged. When phone (React Native/Expo) or the Pi backend arrive, they become new consumers of these same packages, not rewrites.
- Package manager: npm (workspaces). Test runner: Vitest. TypeScript strict mode everywhere. Packages resolve each other directly via source (package.json `main`/`types` point at `src/index.ts`) — no TS project-reference/composite build step; that was tried during M0/M1 and dropped because it required manually rebuilding a `dist/` that nothing in the real toolchain (Vite, esbuild, Vitest) ever reads, and a stale one silently shadowed live source during typecheck.
- Device↔phone link will be BLE or WiFi from the Pi; abstract behind the ShotEvent interface so transport is swappable.
- Decide on React Native/Expo for the mobile port once the web game loop is proven — not committed yet.

## App name — candidates (not final)
Top picks: **Forecaddie** (a forecaddie literally watches where your ball goes; Fore + forecast), **Mulligan** (the do-over — friendly game energy), **Magnus** (the physics making the ball fly). Others considered: Flush, Pure, Smash Factor, Carry, Dimple, Yardstick, Hangtime, BallPark, Snapshot. Avoid anything echoing SkyTrak/Arccos/Shot Scope/Mevo.

## Working conventions with Mehul
- Define jargon inline as micro-learnings when introducing new domain concepts (his explicit preference)
- He values quick scannable references and clean, intentional design
- Prefer small testable milestones over big-bang integration (see hardware ladder — apply the same philosophy to software)
- This is a resume project + personal product + learning vehicle: when there's a choice, prefer the option with a better engineering story and genuine learning over the shortcut
- **Never add Claude as a GitHub contributor/co-author.** No `Co-Authored-By: Claude ...` trailer (or similar) in commit messages — commits should show Mehul as sole author.
