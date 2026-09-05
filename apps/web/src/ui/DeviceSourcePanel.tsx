import type { ShotField } from "@mulligan/shot-source";
import type { DeviceSessionState } from "../game/gameState";

export interface DeviceSourcePanelProps {
  device: DeviceSessionState;
  disabled: boolean;
  onAddressChange: (address: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

const ALL_SHOT_FIELDS: ShotField[] = ["ballSpeed", "launch", "spin", "spinAxis", "startLine"];
const FIELD_LABEL: Record<ShotField, string> = {
  ballSpeed: "Ball speed",
  launch: "Launch",
  spin: "Spin",
  spinAxis: "Spin axis",
  startLine: "Start line",
};

/**
 * Deliberately small once connected -- at the range this gets touched once
 * at the start of a session and never again, so it must not compete for
 * space with the club chips and the Swing button.
 */
export function DeviceSourcePanel({ device, disabled, onAddressChange, onConnect, onDisconnect }: DeviceSourcePanelProps) {
  const { connectionState, deviceInfo, status, address } = device;

  if (connectionState === "connected" && deviceInfo) {
    return (
      <div className="device-panel">
        <div className="device-row">
          <span className="device-dot device-dot-on" />
          <span className="device-label">
            {deviceInfo.deviceId} <span className="device-fw">v{deviceInfo.firmwareVersion}</span>
          </span>
          <button type="button" className="device-action" disabled={disabled} onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
        <div className="provenance device-capabilities">
          {ALL_SHOT_FIELDS.map((field) => (
            <span
              key={field}
              className={"prov " + (deviceInfo.capabilities.includes(field) ? "measured" : "estimated")}
              title={deviceInfo.capabilities.includes(field) ? "This device measures it" : "Estimated -- this device can't measure it"}
            >
              {FIELD_LABEL[field]}
            </span>
          ))}
        </div>
        {status && !status.ready && <div className="device-status-warning">{status.detail ?? "Device reports not ready"}</div>}
      </div>
    );
  }

  const wasConnected = deviceInfo !== null;

  return (
    <div className="device-panel">
      <div className="ctl">
        <label>Device address</label>
        <input
          type="text"
          className="device-address-input"
          value={address}
          disabled={disabled || connectionState === "connecting"}
          onChange={(e) => onAddressChange(e.target.value)}
          placeholder="ws://mulligan.local:8080"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div className="device-row">
        <button
          type="button"
          className="device-action device-connect"
          disabled={disabled || connectionState === "connecting" || address.trim().length === 0}
          onClick={onConnect}
        >
          {connectionState === "connecting" ? "Connecting…" : "Connect"}
        </button>
        {connectionState === "error" && <span className="device-error">Couldn't connect — check the address and try again</span>}
        {connectionState === "disconnected" && wasConnected && (
          <span className="device-error">Disconnected — reconnecting… you can switch to Simulated or Manual to keep playing</span>
        )}
      </div>
    </div>
  );
}
