import type { SkillProfileId } from "@mulligan/shot-source";
import { SKILL_PROFILES } from "@mulligan/shot-source";
import { useState, type ChangeEvent, type MouseEvent } from "react";
import type { Handedness, UnitSystem } from "../preferences";
import type { DeviceSessionState, ShotSourceMode } from "../game/gameState";
import { useFocusTrap } from "../useFocusTrap";
import { AimZeroPanel } from "./AimZeroPanel";
import { DeviceSourcePanel } from "./DeviceSourcePanel";
import { ProvenanceExplainer } from "./ProvenanceExplainer";
import { SourceModeToggle } from "./SourceModeToggle";

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  sourceMode: ShotSourceMode;
  onSourceModeChange: (mode: ShotSourceMode) => void;
  device: DeviceSessionState;
  onDeviceAddressChange: (address: string) => void;
  onConnectDevice: () => void;
  onDisconnectDevice: () => void;
  onAimZeroStart: () => void;
  onAimZeroConfirm: () => void;
  onAimZeroCancel: () => void;
  onExportSession: () => void;
  onImportSessionFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onOpenSessionReview: () => void;
  handedness: Handedness;
  onHandednessChange: (h: Handedness) => void;
  unit: UnitSystem;
  onUnitChange: (u: UnitSystem) => void;
  skillProfileId: SkillProfileId;
  onSkillProfileChange: (id: SkillProfileId) => void;
  onOpenBagEditor: () => void;
}

/**
 * Source selection (Simulated / Manual / Device) and session export/import
 * are touched once per range session, not once per shot -- pulling them out
 * of the main flow into a sheet is what lets the club chips and swing
 * button own the bottom third uncontested. Only a small dot on the top
 * bar's settings icon (see TopBar) stays visible in the main flow.
 */
export function SettingsSheet({
  open,
  onClose,
  sourceMode,
  onSourceModeChange,
  device,
  onDeviceAddressChange,
  onConnectDevice,
  onDisconnectDevice,
  onAimZeroStart,
  onAimZeroConfirm,
  onAimZeroCancel,
  onExportSession,
  onImportSessionFile,
  onOpenSessionReview,
  handedness,
  onHandednessChange,
  unit,
  onUnitChange,
  skillProfileId,
  onSkillProfileChange,
  onOpenBagEditor,
}: SettingsSheetProps) {
  const [explainerOpen, setExplainerOpen] = useState(false);
  const sheetRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={sheetRef} className="sheet" onClick={(e: MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Settings">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <span>Settings</span>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="sheet-section-label">Shot source</div>
        <SourceModeToggle mode={sourceMode} disabled={false} onChange={onSourceModeChange} />

        {sourceMode === "device" && (
          <DeviceSourcePanel
            device={device}
            disabled={false}
            onAddressChange={onDeviceAddressChange}
            onConnect={onConnectDevice}
            onDisconnect={onDisconnectDevice}
          />
        )}
        {sourceMode === "device" && device.connectionState === "connected" && (
          <AimZeroPanel
            sessionZeroDeg={device.sessionZeroDeg}
            zeroConfirmed={device.zeroConfirmed}
            calibratingZero={device.calibratingZero}
            pendingZeroSample={device.pendingZeroSample}
            disabled={false}
            onStart={onAimZeroStart}
            onConfirm={onAimZeroConfirm}
            onCancel={onAimZeroCancel}
          />
        )}

        <div className="sheet-section-label">Preferences</div>
        <div className="pref-row">
          <span className="pref-label">Handedness</span>
          <div className="mode-toggle pref-inline-toggle" role="group" aria-label="Handedness">
            <button type="button" className={"mode-tab" + (handedness === "right" ? " on" : "")} onClick={() => onHandednessChange("right")}>
              Right
            </button>
            <button type="button" className={"mode-tab" + (handedness === "left" ? " on" : "")} onClick={() => onHandednessChange("left")}>
              Left
            </button>
          </div>
        </div>
        <div className="pref-row">
          <span className="pref-label">Units</span>
          <div className="mode-toggle pref-inline-toggle" role="group" aria-label="Units">
            <button type="button" className={"mode-tab" + (unit === "imperial" ? " on" : "")} onClick={() => onUnitChange("imperial")}>
              Yards/ft
            </button>
            <button type="button" className={"mode-tab" + (unit === "metric" ? " on" : "")} onClick={() => onUnitChange("metric")}>
              Meters
            </button>
          </div>
        </div>

        {sourceMode === "simulated" && (
          <div className="pref-row pref-row-stacked">
            <span className="pref-label">
              Skill profile <span className="pref-sublabel">— simulated shots only, never a real device</span>
            </span>
            <div className="mode-toggle">
              {SKILL_PROFILES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={"mode-tab" + (skillProfileId === p.id ? " on" : "")}
                  onClick={() => onSkillProfileChange(p.id)}
                  title={p.description}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="device-action device-action-quiet settings-explainer-toggle" onClick={onOpenBagEditor}>
          Edit bag
        </button>

        <div className="sheet-section-label">About the numbers</div>
        <button
          type="button"
          className="device-action device-action-quiet settings-explainer-toggle"
          onClick={() => setExplainerOpen((v) => !v)}
          aria-expanded={explainerOpen}
        >
          What's measured vs. estimated?
        </button>
        {explainerOpen && <ProvenanceExplainer />}

        <div className="sheet-section-label">Session</div>
        <button type="button" className="device-action device-action-quiet settings-explainer-toggle" onClick={onOpenSessionReview}>
          Review this session
        </button>
        <div className="sheet-session-row">
          <button type="button" className="session-tool-btn" onClick={onExportSession}>
            Export session
          </button>
          <label className="session-tool-btn">
            Import session
            <input type="file" accept="application/json" className="session-file-input" onChange={onImportSessionFile} />
          </label>
        </div>
      </div>
    </div>
  );
}

