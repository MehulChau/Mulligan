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

## Current state: Flight Lab v0 (physics engine prototype)
`flight-lab.html` in this repo — a working single-file interactive ball-flight simulator. This is the seed of the whole app. It has:
- Point-mass flight integration: drag + Magnus lift + gravity, semi-implicit Euler dt=0.004s
- Constants: m=0.04593kg, d=0.04267m, ρ=1.225, K=ρA/2m
- Spin ratio S=ωr/v; CL=min(0.34, 0.54·S^0.4); CD=min(0.34, 0.22+0.55·S); spin decay exp(−0.033t)
- Spin axis tilt → lateral Magnus component (negative = draw/left, positive = fade/right)
- Crude roll estimate from landing angle + spin (labeled as estimate)
- Club presets (ball speed mph / launch° / spin rpm): Driver 150/12.5/2800, 3W 140/13.5/3800, Hybrid 128/15/4600, 5i 118/16.5/5400, 7i 106/18.5/7100, 9i 94/23/8600, Wedge 86/26.5/9300
- Side view + top view canvas rendering with animated flight
- Design language: turf/scorecard aesthetic — sage background, deep fairway green, sand-amber for ball flight, Archivo typeface. Keep this direction.

**Physics needs calibration against Mehul's real range numbers** (his honest 7i and driver carries). Expect to tune CL/CD. This is normal and expected.

## Next milestone: playable hole MVP ("v1 game loop")
- Render a golf hole (2D top-down or stylized 2.5D — think Tiger Woods GBA, NOT 3D photorealism; 3D is explicitly out of scope for v1)
- Loop: see hole + distance to pin → pick club in app → enter/receive launch data → shot renders → walk the hole shot by shot
- Putting: auto-resolved or simple tap-timing minigame (nobody expects real putting at a range)
- Manual/simulated shot entry stands in for the device until hardware exists (design a clean ShotEvent interface: {ballSpeedMph, launchDeg, spinRpm, spinAxisDeg, startLineDeg, clubId, timestamp} — the hardware's ONLY job later is to emit these)
- Scoring vs par; then handicap, challenge modes, ghost multiplayer per the runway

## Tech stack guidance
- v0/v1 game can stay web-first (fast iteration, current prototype is HTML/canvas); phone app is the eventual product — React Native/Expo is the likely path (Mehul has RN-adjacent mobile experience). Decide when the game loop is proven.
- Device↔phone link will be BLE or WiFi from the Pi; abstract behind the ShotEvent interface so transport is swappable.
- Keep the physics engine a pure, dependency-free module (same math must eventually run in app + backend + tests).

## App name — candidates (not final)
Top picks: **Forecaddie** (a forecaddie literally watches where your ball goes; Fore + forecast), **Mulligan** (the do-over — friendly game energy), **Magnus** (the physics making the ball fly). Others considered: Flush, Pure, Smash Factor, Carry, Dimple, Yardstick, Hangtime, BallPark, Snapshot. Avoid anything echoing SkyTrak/Arccos/Shot Scope/Mevo.

## Working conventions with Mehul
- Define jargon inline as micro-learnings when introducing new domain concepts (his explicit preference)
- He values quick scannable references and clean, intentional design
- Prefer small testable milestones over big-bang integration (see hardware ladder — apply the same philosophy to software)
- This is a resume project + personal product + learning vehicle: when there's a choice, prefer the option with a better engineering story and genuine learning over the shortcut
