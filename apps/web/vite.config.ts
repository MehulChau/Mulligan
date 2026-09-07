import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves a project page (not a user/org page) from a subpath
// matching the repo name -- https://mehulchau.github.io/Mulligan/, not the
// domain root. `npm run dev`/`preview` stay at "/" so local URLs don't
// grow an unwanted prefix; only `vite build` (what the deploy workflow
// runs) needs the subpath, via the GITHUB_PAGES env var the workflow sets.
export default defineConfig(({ command }) => {
  const base = command === "build" && process.env.GITHUB_PAGES ? "/Mulligan/" : "/";
  return {
    plugins: [
      react(),
      // Range WiFi is bad and cell service in a bay is often worse -- the
      // app must fully work with no network after first load. Hand-rolling
      // correct cache invalidation against Vite's content-hashed build
      // output is a well-known footgun (stale-forever caches, or a SW that
      // never picks up a new deploy); this is the standard, purpose-built
      // answer for exactly this Vite setup, so it's worth the dependency.
      // Hole data isn't listed as a runtime-cached route because it's
      // statically imported JSON, already inlined into the precached JS
      // bundle -- there's no separate network request for it to intercept.
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icons/*.png"],
        manifest: {
          name: "Mulligan",
          short_name: "Mulligan",
          description: "Play real golf holes from real range swings, measured by a DIY launch monitor.",
          start_url: base,
          scope: base,
          display: "standalone",
          orientation: "portrait",
          background_color: "#f3f6f0",
          theme_color: "#0d3b25",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
            { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // Everything the built app shell needs -- JS/CSS (hashed), HTML,
          // the self-hosted font, and the icons -- precached on first load
          // so the round after that needs no network at all.
          globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
          navigateFallback: `${base}index.html`,
        },
      }),
    ],
    base,
  };
});
