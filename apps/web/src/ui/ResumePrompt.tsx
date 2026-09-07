import { useFocusTrap } from "../useFocusTrap";
import type { PersistedRoundStateV1 } from "../persistence/roundStorage";

export interface ResumePromptProps {
  persisted: PersistedRoundStateV1;
  onResume: () => void;
  onDiscard: () => void;
}

function timeAgo(savedAt: number): string {
  const minutes = Math.round((Date.now() - savedAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

/**
 * Shown once, on boot, only when a round was actually in progress when the
 * app last closed (App.tsx checks IndexedDB before rendering this). Same
 * full-screen-overlay-on-launch pattern as Onboarding -- reuses its
 * backdrop/card styling rather than inventing a second one.
 */
export function ResumePrompt({ persisted, onResume, onDiscard }: ResumePromptProps) {
  const cardRef = useFocusTrap<HTMLDivElement>(true, onDiscard);

  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-label="Resume previous round">
      <div className="onboarding-card resume-card" ref={cardRef}>
        <div className="onboarding-screen">
          <div className="onboarding-icon" aria-hidden="true">
            ⛳
          </div>
          <h2>Resume your round?</h2>
          <p>
            You had a round in progress -- {persisted.strokeCount} stroke{persisted.strokeCount === 1 ? "" : "s"} in,
            saved {timeAgo(persisted.savedAt)}.
          </p>
        </div>
        <div className="onboarding-footer resume-footer">
          <button type="button" className="device-action device-action-quiet" onClick={onDiscard}>
            Start new round
          </button>
          <button type="button" className="hit onboarding-next" onClick={onResume}>
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
