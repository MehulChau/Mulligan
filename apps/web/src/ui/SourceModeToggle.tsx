import type { ShotSourceMode } from "../game/gameState";

export interface SourceModeToggleProps {
  mode: ShotSourceMode;
  disabled: boolean;
  onChange: (mode: ShotSourceMode) => void;
}

export function SourceModeToggle({ mode, disabled, onChange }: SourceModeToggleProps) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="Shot source">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "simulated"}
        className={"mode-tab" + (mode === "simulated" ? " on" : "")}
        disabled={disabled}
        onClick={() => onChange("simulated")}
      >
        Simulated
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "manual"}
        className={"mode-tab" + (mode === "manual" ? " on" : "")}
        disabled={disabled}
        onClick={() => onChange("manual")}
      >
        Manual
      </button>
    </div>
  );
}
