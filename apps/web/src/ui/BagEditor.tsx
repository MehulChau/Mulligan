import { findClub } from "@mulligan/shot-source";
import { useEffect, useRef } from "react";
import type { BagEntry } from "../bag";
import { useFocusTrap } from "../useFocusTrap";

export interface BagEditorProps {
  bag: BagEntry[];
  onChange: (bag: BagEntry[]) => void;
  onClose: () => void;
}

function moveEntry(bag: BagEntry[], index: number, direction: -1 | 1): BagEntry[] {
  const target = index + direction;
  if (target < 0 || target >= bag.length) return bag;
  const next = [...bag];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * "Someone who doesn't carry a 5-wood shouldn't be offered one" -- enable/
 * disable, reorder, and a per-club carry correction, persisted locally
 * (App.tsx saves to localStorage on every onChange). At least one club
 * must stay enabled: the Enabled checkbox is disabled on the last one, so
 * the bag can never reach a state ClubPicker has nothing to show for.
 */
export function BagEditor({ bag, onChange, onClose }: BagEditorProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const headingRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const enabledCount = bag.filter((e) => e.enabled).length;

  function toggleEnabled(index: number) {
    const entry = bag[index]!;
    if (entry.enabled && enabledCount <= 1) return; // never disable the last club
    const next = [...bag];
    next[index] = { ...entry, enabled: !entry.enabled };
    onChange(next);
  }

  function setCarryAdjust(index: number, pct: number) {
    const next = [...bag];
    next[index] = { ...bag[index]!, carryAdjustPct: Math.max(-30, Math.min(30, pct)) };
    onChange(next);
  }

  return (
    <div className="onboarding-backdrop session-review-backdrop" role="dialog" aria-modal="true" aria-label="Edit bag">
      <div className="session-review-card" ref={panelRef}>
        <div className="sheet-header">
          <span ref={headingRef} tabIndex={-1}>
            Edit bag
          </span>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close bag editor">
            ×
          </button>
        </div>

        <div className="session-review-scroll">
          <p className="bag-editor-hint">
            Turn off clubs you don't carry -- they won't be offered, in Simulated or Manual mode. Adjust carry if a
            club consistently goes shorter or longer than the default for you.
          </p>

          <div className="bag-editor-list">
            {bag.map((entry, index) => {
              const club = findClub(entry.clubId);
              return (
                <div className={"bag-editor-row" + (entry.enabled ? "" : " bag-editor-row-disabled")} key={entry.clubId}>
                  <label className="bag-editor-toggle">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      disabled={entry.enabled && enabledCount <= 1}
                      onChange={() => toggleEnabled(index)}
                    />
                    <span className="bag-editor-club-name">{club.name}</span>
                  </label>

                  <div className="bag-editor-carry">
                    <button
                      type="button"
                      className="bag-editor-step"
                      disabled={!entry.enabled}
                      onClick={() => setCarryAdjust(index, entry.carryAdjustPct - 5)}
                      aria-label={`Decrease ${club.name} carry`}
                    >
                      −
                    </button>
                    <span className="bag-editor-carry-value">
                      {entry.carryAdjustPct > 0 ? "+" : ""}
                      {entry.carryAdjustPct}%
                    </span>
                    <button
                      type="button"
                      className="bag-editor-step"
                      disabled={!entry.enabled}
                      onClick={() => setCarryAdjust(index, entry.carryAdjustPct + 5)}
                      aria-label={`Increase ${club.name} carry`}
                    >
                      +
                    </button>
                  </div>

                  <div className="bag-editor-reorder">
                    <button
                      type="button"
                      className="bag-editor-step"
                      disabled={index === 0}
                      onClick={() => onChange(moveEntry(bag, index, -1))}
                      aria-label={`Move ${club.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="bag-editor-step"
                      disabled={index === bag.length - 1}
                      onClick={() => onChange(moveEntry(bag, index, 1))}
                      aria-label={`Move ${club.name} down`}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
