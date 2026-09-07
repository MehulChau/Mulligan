import { formatDistance, type UnitSystem } from "../preferences";

export interface SwingFractionSliderProps {
  fraction: number;
  expectedCarryYds: number;
  disabled?: boolean;
  onChange: (fraction: number) => void;
  unit: UnitSystem;
}

const MIN_PCT = 30;
const MAX_PCT = 100;
const STEP_PCT = 5;

export function SwingFractionSlider({ fraction, expectedCarryYds, disabled, onChange, unit }: SwingFractionSliderProps) {
  const pct = Math.round(fraction * 100);

  return (
    <div className="ctl swing-ctl">
      <label>
        Swing{" "}
        <output>
          {pct}% · ~{formatDistance(expectedCarryYds, unit)}
        </output>
      </label>
      <input
        type="range"
        min={MIN_PCT}
        max={MAX_PCT}
        step={STEP_PCT}
        value={pct}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
    </div>
  );
}
