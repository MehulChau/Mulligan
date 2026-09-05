import type { ClubId, ClubProfile } from "@mulligan/shot-source";
import { findClub } from "@mulligan/shot-source";
import type { SurfaceType } from "../types";

/**
 * Lie restricts which clubs are available, never how a struck shot comes
 * out. A well-struck shot must always be respected -- the player is
 * standing on a mat hitting a real ball. Silently subtracting yards for a
 * "bad lie" the player can't see or feel would break the promise that the
 * range session IS the game session.
 */
export interface ClubAvailability {
  available: boolean;
  /** Shown next to the club when unavailable, e.g. "too thick for a driver". */
  reason?: string;
}

const NO_DRIVER_WOODS: readonly ClubId[] = ["driver", "3w"];
const WEDGES: readonly ClubId[] = ["pw", "gw", "sw", "lw"];

export function clubAvailability(surface: SurfaceType, clubId: ClubId): ClubAvailability {
  switch (surface) {
    case "tee":
    case "fairway":
      return { available: true };

    case "rough":
      if (NO_DRIVER_WOODS.includes(clubId)) {
        return { available: false, reason: `too thick for a ${findClub(clubId).name.toLowerCase()}` };
      }
      return { available: true };

    case "bunker":
      if (!WEDGES.includes(clubId)) {
        return { available: false, reason: "bunker — wedges only" };
      }
      return { available: true };

    case "green":
      return { available: false, reason: "putt instead" };

    case "water":
    case "out":
      return { available: false, reason: "unplayable — drop first" };

    default:
      return { available: true };
  }
}

/** One-line reason the club choices narrowed, for a caption above the picker. Null when nothing is restricted. */
export function lieRestrictionSummary(surface: SurfaceType): string | null {
  switch (surface) {
    case "rough":
      return "Rough — no driver, no 3-wood";
    case "bunker":
      return "Bunker — wedges only";
    default:
      return null;
  }
}

/** First club (in bag order) available at `surface` -- a deterministic fallback when the current selection becomes invalid. */
export function firstAvailableClub(surface: SurfaceType, clubs: readonly ClubProfile[]): ClubId {
  const found = clubs.find((club) => clubAvailability(surface, club.id).available);
  return (found ?? clubs[0]!).id;
}
