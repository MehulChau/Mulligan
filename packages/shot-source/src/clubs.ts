/**
 * The twelve club profiles for the target player (~150 mph ball speed
 * driver). Launch conditions in mph/degrees/rpm — SI conversion happens at
 * the physics module boundary, never here.
 */

export const CLUBS = [
  { id: "driver", name: "Driver", ballSpeedMph: 150, launchDeg: 12.5, spinRpm: 2800 },
  { id: "3w", name: "3-wood", ballSpeedMph: 140, launchDeg: 13.5, spinRpm: 3800 },
  { id: "5w", name: "5-wood", ballSpeedMph: 132, launchDeg: 14.5, spinRpm: 4400 },
  { id: "5h", name: "5-hybrid", ballSpeedMph: 120, launchDeg: 16.0, spinRpm: 5000 },
  { id: "6i", name: "6-iron", ballSpeedMph: 112, launchDeg: 17.5, spinRpm: 6250 },
  { id: "7i", name: "7-iron", ballSpeedMph: 106, launchDeg: 18.5, spinRpm: 7100 },
  { id: "8i", name: "8-iron", ballSpeedMph: 100, launchDeg: 20.75, spinRpm: 7850 },
  { id: "9i", name: "9-iron", ballSpeedMph: 94, launchDeg: 23.0, spinRpm: 8600 },
  { id: "pw", name: "Pitching wedge", ballSpeedMph: 86, launchDeg: 26.5, spinRpm: 9300 },
  { id: "gw", name: "Gap wedge", ballSpeedMph: 79, launchDeg: 28.5, spinRpm: 9700 },
  { id: "sw", name: "Sand wedge", ballSpeedMph: 72, launchDeg: 31.0, spinRpm: 10200 },
  { id: "lw", name: "Lob wedge", ballSpeedMph: 66, launchDeg: 33.5, spinRpm: 10500 },
] as const satisfies readonly {
  id: string;
  name: string;
  ballSpeedMph: number;
  launchDeg: number;
  spinRpm: number;
}[];

/** Derived from CLUBS, not hand-written — adding a club here extends the type automatically. */
export type ClubId = (typeof CLUBS)[number]["id"];

export interface ClubProfile {
  id: ClubId;
  name: string;
  ballSpeedMph: number;
  launchDeg: number;
  spinRpm: number;
}

export function findClub(clubId: ClubId): ClubProfile {
  const club = CLUBS.find((c) => c.id === clubId);
  if (!club) {
    throw new Error(`findClub(): unknown clubId "${clubId}"`);
  }
  return club;
}
