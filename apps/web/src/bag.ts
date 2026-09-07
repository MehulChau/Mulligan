import { CLUBS, type ClubId, type ClubProfile } from "@mulligan/shot-source";

export interface BagEntry {
  clubId: ClubId;
  enabled: boolean;
  /**
   * Percent adjustment to this club's ball speed (and therefore carry) --
   * e.g. -10 for a club that carries shorter than the generic CLUBS preset
   * assumes. Deliberately does NOT touch launch/spin -- carry is primarily
   * a ball-speed story, and this is a coarse per-player correction, not a
   * re-fit of the club's whole flight shape (that's what rescale-clubs +
   * real range data is for).
   */
  carryAdjustPct: number;
}

const BAG_STORAGE_KEY = "mulligan:bag";

/** CLUBS' own order, every club enabled, no adjustment -- what a player who's never touched bag settings sees. */
export function defaultBag(): BagEntry[] {
  return CLUBS.map((c) => ({ clubId: c.id, enabled: true, carryAdjustPct: 0 }));
}

function isBagEntry(v: unknown): v is BagEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.clubId === "string" &&
    CLUBS.some((c) => c.id === o.clubId) &&
    typeof o.enabled === "boolean" &&
    typeof o.carryAdjustPct === "number" &&
    Number.isFinite(o.carryAdjustPct)
  );
}

/** A valid bag must be a permutation of exactly CLUBS' ids, no duplicates, none missing -- reordering/enabling never adds or drops which clubs exist, only how they're offered. */
function isValidBag(v: unknown): v is BagEntry[] {
  if (!Array.isArray(v) || !v.every(isBagEntry)) return false;
  const ids = v.map((e) => e.clubId);
  return ids.length === CLUBS.length && new Set(ids).size === CLUBS.length;
}

export function readStoredBag(): BagEntry[] {
  try {
    const raw = localStorage.getItem(BAG_STORAGE_KEY);
    if (!raw) return defaultBag();
    const parsed: unknown = JSON.parse(raw);
    return isValidBag(parsed) ? parsed : defaultBag();
  } catch {
    return defaultBag();
  }
}

export function saveBag(bag: BagEntry[]): void {
  try {
    localStorage.setItem(BAG_STORAGE_KEY, JSON.stringify(bag));
  } catch {
    // Best effort -- worst case bag edits don't survive a reload.
  }
}

export function isClubEnabled(bag: BagEntry[], clubId: ClubId): boolean {
  return bag.find((e) => e.clubId === clubId)?.enabled ?? true;
}

/** CLUBS filtered to enabled entries, in bag order -- what ClubPicker renders and what auto-club-switching may choose from. */
export function enabledClubsInBagOrder(bag: BagEntry[]): ClubProfile[] {
  const byId = new Map(CLUBS.map((c) => [c.id, c]));
  return bag.filter((e) => e.enabled).map((e) => byId.get(e.clubId)!);
}

export function carryAdjustForClub(bag: BagEntry[], clubId: ClubId): number {
  return bag.find((e) => e.clubId === clubId)?.carryAdjustPct ?? 0;
}

/** Applies a carry adjustment to a club profile's ball speed -- launch/spin untouched. 0% is a no-op returning the same reference. */
export function adjustedClub(club: ClubProfile, carryAdjustPct: number): ClubProfile {
  if (carryAdjustPct === 0) return club;
  return { ...club, ballSpeedMph: club.ballSpeedMph * (1 + carryAdjustPct / 100) };
}
