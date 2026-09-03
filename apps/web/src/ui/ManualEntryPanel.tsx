import type { ManualEntryValues } from "../game/gameState";

export interface ManualEntryPanelProps {
  values: ManualEntryValues;
  disabled: boolean;
  onChange: (field: keyof ManualEntryValues, value: number) => void;
}

interface FieldSpec {
  key: keyof ManualEntryValues;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
  format: (v: number) => string;
}

// Ranges match the ones physics/M0's invariant tests verified are NaN-free
// across (40-200mph, 4-45deg, 1000-11000rpm, +-20deg axis, +-10deg line).
const FIELDS: FieldSpec[] = [
  {
    key: "ballSpeedMph",
    label: "Ball speed",
    min: 40,
    max: 200,
    step: 1,
    hint: "what the device measures",
    format: (v) => `${v.toFixed(0)} mph`,
  },
  {
    key: "launchDeg",
    label: "Launch angle",
    min: 4,
    max: 45,
    step: 0.5,
    hint: "what the device measures",
    format: (v) => `${v.toFixed(1)}°`,
  },
  {
    key: "spinRpm",
    label: "Spin rate",
    min: 1000,
    max: 11000,
    step: 100,
    hint: "estimated on real hardware today",
    format: (v) => `${v.toLocaleString()} rpm`,
  },
  {
    key: "spinAxisDeg",
    label: "Spin axis",
    min: -20,
    max: 20,
    step: 1,
    hint: "negative draws left, positive fades right",
    format: (v) => (v === 0 ? "0°" : `${Math.abs(v).toFixed(0)}° ${v < 0 ? "draw" : "fade"}`),
  },
  {
    key: "startLineDeg",
    label: "Start line",
    min: -10,
    max: 10,
    step: 0.5,
    hint: "relative to your aim, not the pin",
    format: (v) => (v === 0 ? "0°" : `${Math.abs(v).toFixed(1)}° ${v < 0 ? "L" : "R"}`),
  },
];

export function ManualEntryPanel({ values, disabled, onChange }: ManualEntryPanelProps) {
  return (
    <div className="manual-panel">
      {FIELDS.map((field) => (
        <div className="ctl slider-ctl" key={field.key}>
          <label>
            {field.label} <output>{field.format(values[field.key])}</output>
          </label>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={values[field.key]}
            disabled={disabled}
            onChange={(e) => onChange(field.key, Number(e.target.value))}
          />
          <small>{field.hint}</small>
        </div>
      ))}
    </div>
  );
}
