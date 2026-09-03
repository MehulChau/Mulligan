export interface AimSliderProps {
  aimOffsetDeg: number;
  disabled?: boolean;
  onChange: (deg: number) => void;
}

const RANGE_DEG = 30;

export function AimSlider({ aimOffsetDeg, disabled, onChange }: AimSliderProps) {
  const label =
    aimOffsetDeg === 0
      ? "Aimed at pin"
      : `${Math.abs(aimOffsetDeg).toFixed(0)}° ${aimOffsetDeg > 0 ? "right" : "left"} of pin`;

  return (
    <div className="ctl aim-ctl">
      <label>
        Aim <output>{label}</output>
      </label>
      <input
        type="range"
        min={-RANGE_DEG}
        max={RANGE_DEG}
        step={1}
        value={aimOffsetDeg}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
