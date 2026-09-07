import { createContext, useContext, useState, type ReactNode } from "react";
import { SKILL_PROFILES, type SkillProfileId } from "@mulligan/shot-source";

export type Handedness = "right" | "left";
export type UnitSystem = "imperial" | "metric";

const HANDEDNESS_KEY = "mulligan:handedness";
const UNIT_KEY = "mulligan:unit-system";
const SKILL_PROFILE_KEY = "mulligan:skill-profile";
const DEFAULT_SKILL_PROFILE_ID: SkillProfileId = "regular";

function readHandedness(): Handedness {
  try {
    return localStorage.getItem(HANDEDNESS_KEY) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}

function readUnitSystem(): UnitSystem {
  try {
    return localStorage.getItem(UNIT_KEY) === "metric" ? "metric" : "imperial";
  } catch {
    return "imperial";
  }
}

function readSkillProfileId(): SkillProfileId {
  try {
    const stored = localStorage.getItem(SKILL_PROFILE_KEY);
    return (SKILL_PROFILES.find((p) => p.id === stored)?.id ?? DEFAULT_SKILL_PROFILE_ID) as SkillProfileId;
  } catch {
    return DEFAULT_SKILL_PROFILE_ID;
  }
}

interface PreferencesContextValue {
  handedness: Handedness;
  setHandedness: (h: Handedness) => void;
  unit: UnitSystem;
  setUnit: (u: UnitSystem) => void;
  /**
   * Only ever reaches SimulatedShotSource (see App.tsx's setDispersion
   * call) -- ManualShotSource and NetworkShotSource have no DispersionParams
   * input to receive it through. A real device's measured numbers are
   * never adjusted by this setting; that's not a discipline rule enforced
   * by convention, there's simply no code path for it to happen through.
   */
  skillProfileId: SkillProfileId;
  setSkillProfileId: (id: SkillProfileId) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/**
 * Player-level preferences that outlive any one round: which hand they
 * play, which units they think in. Persisted to localStorage (like the
 * device address) rather than the IndexedDB round state (Part B) --
 * these describe the player, not a specific round, and should carry
 * forward across "New round" the same way the device connection does.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [handedness, setHandednessState] = useState<Handedness>(readHandedness);
  const [unit, setUnitState] = useState<UnitSystem>(readUnitSystem);
  const [skillProfileId, setSkillProfileIdState] = useState<SkillProfileId>(readSkillProfileId);

  function setHandedness(h: Handedness) {
    setHandednessState(h);
    try {
      localStorage.setItem(HANDEDNESS_KEY, h);
    } catch {
      // Best effort -- worst case the choice doesn't survive a reload.
    }
  }

  function setUnit(u: UnitSystem) {
    setUnitState(u);
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      // Best effort, same as above.
    }
  }

  function setSkillProfileId(id: SkillProfileId) {
    setSkillProfileIdState(id);
    try {
      localStorage.setItem(SKILL_PROFILE_KEY, id);
    } catch {
      // Best effort, same as above.
    }
  }

  return (
    <PreferencesContext.Provider value={{ handedness, setHandedness, unit, setUnit, skillProfileId, setSkillProfileId }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}

// ---------- unit formatting ----------
// Distance is the only thing this app displays that has a unit at all --
// ball speed (mph) and spin (rpm) are measurement/estimation quantities
// tied to the device and physics domain, not a player-facing preference,
// so they're deliberately NOT converted here.

const YDS_TO_M = 0.9144;

/** Long-distance display (carry, distance to pin, session medians) -- whole-number precision. */
export function formatDistance(yds: number, unit: UnitSystem): string {
  return unit === "metric" ? `${Math.round(yds * YDS_TO_M)} m` : `${Math.round(yds)} yds`;
}

export function distanceUnitLabel(unit: UnitSystem): string {
  return unit === "metric" ? "m" : "yds";
}

export function distanceValue(yds: number, unit: UnitSystem): number {
  return Math.round(unit === "metric" ? yds * YDS_TO_M : yds);
}

/** Putting-scale display -- feet in imperial (matches how golfers actually talk about putts), meters in metric. */
export function formatShortDistance(yds: number, unit: UnitSystem): string {
  if (unit === "metric") {
    const m = yds * YDS_TO_M;
    if (m < 0.3) return "a tap-in";
    return `${m.toFixed(m < 3 ? 1 : 0)} m`;
  }
  const feet = yds * 3;
  if (feet < 1) return "a tap-in";
  return `${feet.toFixed(feet < 10 ? 1 : 0)} ft`;
}
