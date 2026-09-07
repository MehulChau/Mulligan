import { useEffect } from "react";

/**
 * Keeps the screen awake for as long as `active` is true -- a round at the
 * range has real dead time between swings (walking off, picking a club,
 * re-reading the numbers), and a phone that sleeps mid-round means an extra
 * unlock-and-find-your-place every time. Unsupported browsers (no
 * navigator.wakeLock) just don't get this; there's no polyfill for it, so
 * fail silently rather than warn about something the player can't fix.
 *
 * The lock is released by the OS whenever the tab is hidden (screen off,
 * app backgrounded, tab switched) and does NOT come back on its own --
 * re-request on visibilitychange, per the spec's own recommended pattern.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    // "wakeLock" in navigator, not a truthiness check on navigator.wakeLock
    // itself -- the DOM lib types it as always-present (WakeLock, not
    // WakeLock | undefined), so a browser that lacks it entirely still
    // needs an actual presence check, not a type-narrowing one.
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          // `active` flipped false (or the effect re-ran) while the request
          // was in flight -- release immediately rather than leaking it.
          lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch {
        // Request can reject for reasons outside our control (battery
        // saver, an already-hidden document, browser policy) -- silent
        // fallback, same as the feature-detection branch above.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && sentinel === null) {
        acquire();
      }
    }

    acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
