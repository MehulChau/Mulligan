# Range session checklist

Pull this up on your phone between swings. Goal: enough real numbers to
replace guesses in `@mulligan/physics` and `@mulligan/shot-source`.

## Bring

- Phone (this page)
- Whatever's measuring ball speed / launch / carry (Trackman, GCQuad, etc.)
- **3 clubs: driver, 7-iron, a wedge** (pitching wedge is fine)

## Per club — 5 numbers, full swing

Hit 8–10 solid balls with each club. Pick the shot closest to your median
carry (or just the one that felt normal) and write down that shot's:

- [ ] Ball speed (mph)
- [ ] Launch angle (deg)
- [ ] Carry (yds)
- [ ] Apex (ft)
- [ ] Descent angle (deg)
- [ ] Spin (rpm) — **only** if the monitor shows it, skip otherwise

Do this for all 3 clubs. That's the whole ask for this part.

**Goes into:** `MEASUREMENTS` in
`packages/shot-source/src/calibration/measurements.ts` — one object per
club, `source: "range-session-<today's date>"`. There's a filled-in example
commented right above the array.

## Wedge-spread step (wedge only, extra)

This is separate from the 5 numbers above — it's about scatter, not one
good shot. Hit two buckets with the wedge:

1. **Full swing**, 8–10 balls
2. **Half swing** (~50%), 8–10 balls

For each bucket, write down:

- [ ] Shot count
- [ ] Carry: min / median / max (yds) — or every shot, if you're tracking each one
- [ ] Left-right spread (yds), edge to edge across the whole group
- [ ] Swing fraction (`1.0` for the full bucket, `0.5` for the half bucket)

**Goes into:** `DISPERSION_MEASUREMENTS` in the same file, right below
`MEASUREMENTS`. Also has a filled-in example commented above it.

## After the range

From the repo root:

```
npm run calibrate
```

It fits the physics model against `MEASUREMENTS` and prints a before/after
table — it **never** overwrites anything automatically. If the fit looks
right, paste the printed numbers into `packages/physics/src/aero.ts` by
hand.

`DISPERSION_MEASUREMENTS` isn't auto-fitted (no optimizer for it yet) —
it's there so `partialSwingPenalty` in
`packages/shot-source/src/swing.ts` can eventually be tuned against real
spread numbers instead of a guess.

Then, using the same 3 clubs' ball speed and launch from above:

```
npm run rescale-clubs -- \
  --driverSpeed=<mph> --driverLaunch=<deg> \
  --sevenIronSpeed=<mph> --sevenIronLaunch=<deg> \
  --wedgeClub=<pw|gw|sw|lw> --wedgeSpeed=<mph> --wedgeLaunch=<deg>
```

`CLUBS` (`packages/shot-source/src/clubs.ts`) describes a generic
~150mph-driver player, not you — the aero fit above corrects the physics
model, not the presets, so without this step the game still shows a
stranger's distances on every club. This prints a proposed twelve-club
table (interpolated by club position between your 3 measured clubs,
launch angle scaled more conservatively than speed) — again, **prints
only, never writes**. Paste the numbers into `clubs.ts` by hand if they
look right.

**If you change `clubs.ts`, regenerate the golden fixture afterward**
(`packages/physics/tests/fixtures/golden.json`) — the presets are its
inputs, so a rescale invalidates it. That's a deliberate, reviewed
regeneration each time, never automatic.
