import { describe, expect, it } from "vitest";
import { CLUBS, findClub } from "../src/clubs";
import { enrichShot } from "../src/enrich";
import type { RawShotEvent } from "../src/types";

describe("enrichShot", () => {
  it("marks ballSpeed and launch as measured — they always come from the raw event", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1 };
    const shot = enrichShot(raw, "7i");
    expect(shot.provenance.ballSpeed).toBe("measured");
    expect(shot.provenance.launch).toBe("measured");
    expect(shot.ballSpeedMph).toBe(106);
    expect(shot.launchDeg).toBe(18.5);
  });

  it("estimates spin from the club profile, scaled by swing speed vs. the club's reference speed", () => {
    const club = findClub("7i");
    const raw: RawShotEvent = { ballSpeedMph: club.ballSpeedMph * 1.1, launchDeg: 18.5, timestamp: 1 };
    const shot = enrichShot(raw, "7i");
    expect(shot.provenance.spin).toBe("estimated");
    expect(shot.spinRpm).toBeCloseTo(club.spinRpm * 1.1, 5);
  });

  it("passes through a real spin measurement untouched and marks it measured", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1, spinRpm: 6900 };
    const shot = enrichShot(raw, "7i");
    expect(shot.provenance.spin).toBe("measured");
    expect(shot.spinRpm).toBe(6900);
  });

  it("defaults spin axis to 0 and marks it estimated when absent", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1 };
    const shot = enrichShot(raw, "7i");
    expect(shot.spinAxisDeg).toBe(0);
    expect(shot.provenance.spinAxis).toBe("estimated");
  });

  it("passes through a real spin axis measurement and marks it measured", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1, spinAxisDeg: 4.5 };
    const shot = enrichShot(raw, "7i");
    expect(shot.spinAxisDeg).toBe(4.5);
    expect(shot.provenance.spinAxis).toBe("measured");
  });

  it("defaults start line to 0 and marks it estimated when absent — every shot must be navigable", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1 };
    const shot = enrichShot(raw, "7i");
    expect(shot.startLineDeg).toBe(0);
    expect(shot.provenance.startLine).toBe("estimated");
  });

  it("passes through a real start line measurement and marks it measured", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1, startLineDeg: -2.5 };
    const shot = enrichShot(raw, "7i");
    expect(shot.startLineDeg).toBe(-2.5);
    expect(shot.provenance.startLine).toBe("measured");
  });

  it("stamps the selected clubId and passes the timestamp through unchanged", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1725000000 };
    const shot = enrichShot(raw, "7i");
    expect(shot.clubId).toBe("7i");
    expect(shot.timestamp).toBe(1725000000);
  });

  it("throws on an unknown clubId", () => {
    const raw: RawShotEvent = { ballSpeedMph: 106, launchDeg: 18.5, timestamp: 1 };
    // @ts-expect-error deliberately invalid clubId to exercise the runtime guard
    expect(() => enrichShot(raw, "putter")).toThrow(/unknown clubId/);
  });

  it("enriches every club in the bag without error", () => {
    for (const club of CLUBS) {
      const raw: RawShotEvent = { ballSpeedMph: club.ballSpeedMph, launchDeg: club.launchDeg, timestamp: 1 };
      const shot = enrichShot(raw, club.id);
      expect(shot.clubId).toBe(club.id);
      expect(Number.isFinite(shot.spinRpm)).toBe(true);
    }
  });
});
