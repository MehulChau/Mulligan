import type { Hole } from "@mulligan/game";
import { useFocusTrap } from "../useFocusTrap";

export interface HoleSelectProps {
  course: readonly Hole[];
  currentIndex: number;
  roundScores: Partial<Record<string, number>>;
  onSelect: (index: number) => void;
  onClose: () => void;
}

function toParText(strokes: number, par: number): string {
  const diff = strokes - par;
  if (diff === 0) return "E";
  return diff > 0 ? `+${diff}` : `${diff}`;
}

/**
 * Jump to any hole, in or out of round order -- at a range you might want
 * to hit the same tee shot repeatedly, not necessarily play 1 through 6.
 * Same bottom-sheet shell as SettingsSheet for a consistent feel, but this
 * one is reachable from the top bar directly (tapping the hole name/par),
 * not tucked behind the settings icon -- it's a normal part of the flow,
 * not a once-a-session setting.
 */
export function HoleSelect({ course, currentIndex, roundScores, onSelect, onClose }: HoleSelectProps) {
  // Mounted only while open (App.tsx: {holeSelectOpen && <HoleSelect .../>}),
  // so "open" is always true for the lifetime of this component -- the
  // trap's cleanup (restoring focus) runs on unmount, which is exactly
  // when this closes.
  const sheetRef = useFocusTrap<HTMLDivElement>(true, onClose);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={sheetRef} className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose a hole">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <span>Choose a hole</span>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="hole-select-list">
          {course.map((hole, i) => {
            const score = roundScores[hole.id];
            return (
              <button
                key={hole.id}
                type="button"
                className={"hole-select-row" + (i === currentIndex ? " on" : "")}
                onClick={() => onSelect(i)}
              >
                <span className="hole-select-num">{i + 1}</span>
                <span className="hole-select-info">
                  <span className="hole-select-name">{hole.name}</span>
                  <span className="hole-select-par">Par {hole.par}</span>
                </span>
                <span className="hole-select-score">
                  {score !== undefined ? (
                    <>
                      {score} <span className="hole-select-topar">{toParText(score, hole.par)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
