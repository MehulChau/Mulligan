import { CLUBS, SKILL_PROFILES, type ShotLogEntry, type SkillProfileId } from "@mulligan/shot-source";
import type { HoleCompletion } from "./history";
import type { BagEntry } from "../bag";
import type { Handedness, UnitSystem } from "../preferences";

const SCHEMA_VERSION = 1;

export interface EverythingExportPreferences {
  handedness: Handedness;
  unit: UnitSystem;
  skillProfileId: SkillProfileId;
}

export interface EverythingExportV1 {
  schemaVersion: 1;
  exportedAt: number;
  shotLog: ShotLogEntry[];
  holeCompletions: HoleCompletion[];
  bag: BagEntry[];
  preferences: EverythingExportPreferences;
}

/**
 * "The substitute for accounts" -- every shot ever logged, every hole
 * completion (the data personal bests/history are built from), the bag,
 * and preferences, in one file. Distinct from the existing per-session
 * export (Settings > Export session): that one is a single range visit
 * for replay/debugging, this is a full backup of everything the app
 * knows about the player.
 */
export function buildEverythingExport(
  shotLog: ShotLogEntry[],
  holeCompletions: HoleCompletion[],
  bag: BagEntry[],
  preferences: EverythingExportPreferences,
): EverythingExportV1 {
  return { schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), shotLog, holeCompletions, bag, preferences };
}

export function everythingExportToJSON(bundle: EverythingExportV1): string {
  return JSON.stringify(bundle, null, 2);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CLUB_IDS: readonly string[] = CLUBS.map((c) => c.id);
const SKILL_PROFILE_IDS: readonly string[] = SKILL_PROFILES.map((p) => p.id);

function isValidPreferences(v: unknown): v is EverythingExportPreferences {
  return (
    isPlainObject(v) &&
    (v.handedness === "left" || v.handedness === "right") &&
    (v.unit === "imperial" || v.unit === "metric") &&
    typeof v.skillProfileId === "string" &&
    SKILL_PROFILE_IDS.includes(v.skillProfileId)
  );
}

function isValidBagEntry(v: unknown): boolean {
  return (
    isPlainObject(v) &&
    typeof v.clubId === "string" &&
    CLUB_IDS.includes(v.clubId) &&
    typeof v.enabled === "boolean" &&
    typeof v.carryAdjustPct === "number" &&
    Number.isFinite(v.carryAdjustPct)
  );
}

/**
 * Parses and validates a previously exported bundle. Real checks on the
 * shape that would otherwise crash a consumer (bag entries feed straight
 * into ClubPicker/SimulatedShotSource, preferences feed the units/
 * handedness context) -- deliberately lighter on individual shotLog/
 * holeCompletions entries, since ShotLog and the stats functions that
 * consume them already treat most per-entry fields as optional and
 * degrade gracefully (a malformed entry just doesn't contribute to a
 * stat, same as Part B's posture: fail toward "ignore this," never crash).
 * Returns null on anything wrong -- the caller's only job on null is to
 * tell the player the import failed, never to guess at a partial repair.
 */
export function parseEverythingImport(text: string): EverythingExportV1 | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) return null;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.shotLog)) return null;
    if (!Array.isArray(parsed.holeCompletions)) return null;
    if (!Array.isArray(parsed.bag) || !parsed.bag.every(isValidBagEntry)) return null;
    if (!isValidPreferences(parsed.preferences)) return null;
    return parsed as unknown as EverythingExportV1;
  } catch {
    return null;
  }
}
