# docs/

What's here and why, so a reader doesn't have to open every file to find out.

- **[device-protocol.md](device-protocol.md)** — the canonical wire contract between the Pi (device) and this app. Start here if you're touching `NetworkShotSource`, building the device side (`mulligan-device`), or wondering whether a deployed copy of this app can reach a device on your local network (short answer: not without extra work — see that doc's "HTTPS deployment and mixed content" section).
- **[range-session.md](range-session.md)** — a phone-sized checklist for the actual range trip that still hasn't happened. Real driver/7-iron/wedge carry+launch+descent numbers, once collected here, are what `npm run calibrate` and `npm run rescale-clubs` need to stop leaning on published tour averages for this specific player.
- **[playtest-findings.md](playtest-findings.md)** — Monte Carlo findings for HOLE_1 ("The Bend") from `tools/playtest.ts`: club/aim policy comparisons, score distributions, whether the dogleg and hazards actually matter to the outcome.
- **[course-playtest-findings.md](course-playtest-findings.md)** — the same harness (`tools/course-playtest.ts`) run across all six holes, plus whole-course club-usage numbers.
- **open-questions.md** — genuine ambiguities logged instead of guessed at, when a task's own brief calls for that discipline. Doesn't exist right now because none has come up yet that crossed that bar; it'll appear here the day one does.

Everything above is generated or hand-maintained project documentation. The single most load-bearing account of the project's own history and decisions is **`CLAUDE.md`** at the repo root, not anything in this folder — that file is the running log every milestone gets written into, and the right place to start if you want the full story rather than a specific reference doc.
