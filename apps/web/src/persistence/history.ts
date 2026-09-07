import { idbGetAll, idbSet } from "./idb";

const STORE = "holeCompletions";

/**
 * One row per hole holed out, ever -- this is the durable record Part D's
 * history/personal-bests/progress features are built on. GameState's
 * `roundScores` (Part B/C) only lives for the current round; once "New
 * round" fires or the tab closes, it's gone. This store is what survives
 * that, the same way ShotLog already survives it for individual strokes.
 *
 * A "round" isn't tracked as its own record -- it's derived by grouping
 * these by `sessionId` (see historyStats.ts), so nothing has to be
 * finalized or written twice; one row per hole is the only write this
 * module ever does.
 */
export interface HoleCompletion {
  id: string;
  sessionId: string;
  timestamp: number;
  courseHoleIndex: number;
  holeId: string;
  holeName: string;
  par: number;
  strokes: number;
}

export async function recordHoleCompletion(entry: HoleCompletion): Promise<void> {
  await idbSet(STORE, entry.id, entry);
}

export async function getAllHoleCompletions(): Promise<HoleCompletion[]> {
  const all = await idbGetAll<HoleCompletion>(STORE);
  return all.sort((a, b) => a.timestamp - b.timestamp);
}
