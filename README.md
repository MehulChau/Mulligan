# Mulligan

[![CI](https://github.com/MehulChau/Mulligan/actions/workflows/ci.yml/badge.svg)](https://github.com/MehulChau/Mulligan/actions/workflows/ci.yml)

DIY golf launch monitor + phone golf simulator. (Full project writeup lands
in a later pass — this is a working stub covering setup and deploy.)

## Run it locally

```
npm install
npm run dev
```

Opens the printed localhost URL. `SimulatedShotSource` stands in for real
hardware, so a full round is playable with no device connected.

## Deploy

Pushing to `master` builds the app and deploys it to GitHub Pages via
`.github/workflows/deploy.yml` — no account or hosting cost beyond what the
repo already has. The production build uses `/Mulligan/` as its base path
(`apps/web/vite.config.ts`, gated on a `GITHUB_PAGES` env var the workflow
sets) since a GitHub Pages project page is served from a subpath, not the
domain root; local `npm run dev`/`npm run preview` stay at `/`.

The deployed app is a PWA (offline-capable after first load, installable to
the home screen) — see `docs/device-protocol.md` for why a GitHub-Pages
deployment specifically **cannot** reach a real device over the local
network out of the box, and the honest options for working around it.

## Play without hardware

Three shot sources, switchable from in-app Settings: **Simulated** (dispersed
shots per club), **Manual** (type in the numbers directly), and **Device**
(a real launch monitor, or `npm run mock-device` standing in for one — see
`docs/device-protocol.md`).
