import type { RawShotEvent } from "@mulligan/shot-source";

export interface AimZeroPanelProps {
  sessionZeroDeg: number;
  zeroConfirmed: boolean;
  calibratingZero: boolean;
  pendingZeroSample: RawShotEvent | null;
  disabled: boolean;
  onStart: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Aim zeroing (docs/device-protocol.md): the device measures startLineDeg
 * relative to its own fixed mounting, not the player's aim. This is the
 * one-tap workflow that reconciles the two, once per session -- and again
 * any time the player moves bays. See gameState.ts's DeviceSessionState
 * for why the confirmed value survives a "Play again."
 */
export function AimZeroPanel({
  sessionZeroDeg,
  zeroConfirmed,
  calibratingZero,
  pendingZeroSample,
  disabled,
  onStart,
  onConfirm,
  onCancel,
}: AimZeroPanelProps) {
  if (calibratingZero) {
    if (pendingZeroSample) {
      const sampled = pendingZeroSample.startLineDeg ?? 0;
      return (
        <div className="aimzero-panel aimzero-calibrating">
          <span className="aimzero-text">
            Captured <b>{sampled.toFixed(1)}°</b> off your target
          </span>
          <div className="aimzero-actions">
            <button type="button" className="device-action" onClick={onConfirm}>
              Set as zero
            </button>
            <button type="button" className="device-action device-action-quiet" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="aimzero-panel aimzero-calibrating">
        <span className="aimzero-text">Point at your target and hit a shot to sample it…</span>
        <button type="button" className="device-action device-action-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="aimzero-panel">
      <span className="aimzero-text">
        {zeroConfirmed ? (
          <>
            Aim zero: <b>{sessionZeroDeg.toFixed(1)}°</b>
          </>
        ) : (
          "Aim not zeroed yet"
        )}
      </span>
      <button type="button" className="device-action device-action-quiet" disabled={disabled} onClick={onStart}>
        {zeroConfirmed ? "Re-zero" : "Zero aim"}
      </button>
    </div>
  );
}
