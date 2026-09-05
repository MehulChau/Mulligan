import { CLUBS, type ClubId } from "@mulligan/shot-source";
import { describe, expect, it } from "vitest";
import { clubAvailability, firstAvailableClub, lieRestrictionSummary } from "../src/rules/clubAvailability";

const ALL_CLUB_IDS = CLUBS.map((c) => c.id);
const WEDGE_IDS: ClubId[] = ["pw", "gw", "sw", "lw"];

describe("clubAvailability", () => {
  it("allows every club from the tee and fairway", () => {
    for (const surface of ["tee", "fairway"] as const) {
      for (const clubId of ALL_CLUB_IDS) {
        expect(clubAvailability(surface, clubId).available).toBe(true);
      }
    }
  });

  it("bans driver and 3-wood from the rough, with a reason, and allows everything else", () => {
    for (const clubId of ALL_CLUB_IDS) {
      const result = clubAvailability("rough", clubId);
      if (clubId === "driver" || clubId === "3w") {
        expect(result.available).toBe(false);
        expect(result.reason).toBeTruthy();
      } else {
        expect(result.available).toBe(true);
      }
    }
  });

  it("restricts the bunker to wedges only, with a reason", () => {
    for (const clubId of ALL_CLUB_IDS) {
      const result = clubAvailability("bunker", clubId);
      if (WEDGE_IDS.includes(clubId)) {
        expect(result.available).toBe(true);
      } else {
        expect(result.available).toBe(false);
        expect(result.reason).toBeTruthy();
      }
    }
  });

  it("disallows every club on the green (putting takes over instead)", () => {
    for (const clubId of ALL_CLUB_IDS) {
      const result = clubAvailability("green", clubId);
      expect(result.available).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });

  it("never leaves every club unavailable at once for a playable lie", () => {
    for (const surface of ["tee", "fairway", "rough", "bunker"] as const) {
      const anyAvailable = ALL_CLUB_IDS.some((clubId) => clubAvailability(surface, clubId).available);
      expect(anyAvailable).toBe(true);
    }
  });
});

describe("lieRestrictionSummary", () => {
  it("is null where nothing is restricted", () => {
    expect(lieRestrictionSummary("tee")).toBeNull();
    expect(lieRestrictionSummary("fairway")).toBeNull();
  });

  it("describes the restriction for rough and bunker", () => {
    expect(lieRestrictionSummary("rough")).toMatch(/driver/i);
    expect(lieRestrictionSummary("bunker")).toMatch(/wedge/i);
  });
});

describe("firstAvailableClub", () => {
  it("picks a club that is actually available at that surface", () => {
    for (const surface of ["tee", "fairway", "rough", "bunker"] as const) {
      const clubId = firstAvailableClub(surface, CLUBS);
      expect(clubAvailability(surface, clubId).available).toBe(true);
    }
  });
});
