import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts deliberately -- the PWA plugin there is a
// build-time concern (service worker generation, manifest injection) with
// nothing to offer a test run, and pulling it into the test config risks
// it trying to do that work against jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Without a real origin, jsdom's own localStorage/indexedDB access can
    // be shadowed by Node 22+'s experimental global `localStorage` (which
    // needs a --localstorage-file flag to actually work) instead of
    // jsdom's -- pinning a URL is what makes `localStorage` in tests be
    // the same jsdom-backed implementation the app gets in a real browser.
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
  },
});
