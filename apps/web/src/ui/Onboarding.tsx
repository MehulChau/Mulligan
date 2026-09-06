import { useState } from "react";
import { useFocusTrap } from "../useFocusTrap";
import { ProvenanceExplainer } from "./ProvenanceExplainer";

export interface OnboardingProps {
  onDone: () => void;
}

const SCREEN_COUNT = 3;

/**
 * First-run only (App.tsx gates this on localStorage), three screens,
 * skippable at every step -- the range rhythm this app is built around
 * doesn't leave room for a real tutorial, so this explains just enough to
 * start swinging: what this is, standalone vs. connected, and how a turn
 * works. Never shown again once dismissed, by skip or by finishing it.
 */
export function Onboarding({ onDone }: OnboardingProps) {
  const [screen, setScreen] = useState(0);
  // Escape skips, same as tapping Skip; no separate trigger element to
  // restore focus to since this appears on mount, not from a button press.
  const cardRef = useFocusTrap<HTMLDivElement>(true, onDone);

  function next() {
    if (screen < SCREEN_COUNT - 1) setScreen(screen + 1);
    else onDone();
  }

  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-label="Welcome to Mulligan">
      <div className="onboarding-card" ref={cardRef}>
        <button type="button" className="onboarding-skip" onClick={onDone}>
          Skip
        </button>

        {screen === 0 && (
          <div className="onboarding-screen">
            <div className="onboarding-icon" aria-hidden="true">
              ⛳
            </div>
            <h2>Your real swings, a real round</h2>
            <p>
              Mulligan turns a range session into a golf hole: pick a club, swing, and watch the ball you actually
              hit fly and come to rest. The range session <em>is</em> the game session.
            </p>
          </div>
        )}

        {screen === 1 && (
          <div className="onboarding-screen">
            <div className="onboarding-icon" aria-hidden="true">
              📡
            </div>
            <h2>Standalone, or connected</h2>
            <p>
              Play right now with Simulated shots -- no hardware needed. When a launch monitor is set up, switch to
              Device mode in Settings and your real ball speed and launch angle drive the shot instead.
            </p>
          </div>
        )}

        {screen === 2 && (
          <div className="onboarding-screen">
            <div className="onboarding-icon" aria-hidden="true">
              🎯
            </div>
            <h2>How a turn works</h2>
            <p>Glance at the distance, tap a club, tap Swing. Repeat until you're in the hole, then putt it out.</p>
            <ProvenanceExplainer />
          </div>
        )}

        <div className="onboarding-footer">
          <div className="onboarding-dots" aria-hidden="true">
            {Array.from({ length: SCREEN_COUNT }, (_, i) => (
              <span key={i} className={"onboarding-dot" + (i === screen ? " on" : "")} />
            ))}
          </div>
          <button type="button" className="hit onboarding-next" onClick={next}>
            {screen === SCREEN_COUNT - 1 ? "Let's play" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
