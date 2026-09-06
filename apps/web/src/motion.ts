import { useEffect, useState } from "react";

/**
 * Motion discipline (visual milestone, Part 5): one shared easing curve and
 * two durations everywhere in the app -- fast for feedback (a tap, a panel
 * opening), slower for the one thing that's actually supposed to take a
 * moment (ball flight, the shot-readout count-up). Mirrored as CSS custom
 * properties in App.css (--ease, --dur-fast, --dur-slow) so canvas and DOM
 * animation agree without duplicating the numbers.
 */
export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"; // ease-out-quint-ish -- decisive start, soft settle
export const DUR_FAST_MS = 180;
export const DUR_SLOW_MS = 900;

/** Tracks prefers-reduced-motion live (a user can change it without reloading). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
