import { ShotLog, createMemoryStore, type ShotLogEntry } from "./ShotLog";

/**
 * A session recorded in browser storage is the most valuable data this
 * project has once real range shots exist in it -- it must be able to
 * leave the phone. This is the export/import boundary: `exportSession`
 * captures a session's entries plus whatever session-level metadata the
 * caller wants preserved (aim zero, simulator seed, anything that isn't
 * itself a per-shot log entry); `importSessionFromJSON` parses it back;
 * `loadImportedSessionIntoLog` feeds it into a `ShotLog` a
 * `ReplayShotSource` can run against. A session you can't replay is a
 * session you can only debug once.
 */
export const SESSION_EXPORT_FORMAT_VERSION = 1;

export interface SessionExport {
  formatVersion: number;
  sessionId: string;
  exportedAt: number;
  /**
   * Free-form session-level facts this module doesn't otherwise know how
   * to name -- e.g. the aim-zero degrees, the SimulatedShotSource seed in
   * use. Opaque here on purpose: shot-source doesn't know what a "session
   * zero" is, that's a game/app concept, but the exported file still needs
   * to carry it if a round is going to be reconstructable.
   */
  metadata: Record<string, unknown>;
  entries: ShotLogEntry[];
}

export function exportSession(log: ShotLog, sessionId: string, metadata: Record<string, unknown> = {}): SessionExport {
  return {
    formatVersion: SESSION_EXPORT_FORMAT_VERSION,
    sessionId,
    exportedAt: Date.now(),
    metadata,
    entries: log.getSession(sessionId),
  };
}

export function sessionExportToJSON(exported: SessionExport): string {
  return JSON.stringify(exported, null, 2);
}

export interface ImportedSession {
  sessionId: string;
  metadata: Record<string, unknown>;
  entries: ShotLogEntry[];
}

/** Parses and validates a previously exported session. Throws (never returns a partial result) on malformed input or an unsupported formatVersion. */
export function importSessionFromJSON(json: string): ImportedSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("importSessionFromJSON: not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("importSessionFromJSON: expected a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.formatVersion !== SESSION_EXPORT_FORMAT_VERSION) {
    throw new Error(`importSessionFromJSON: unsupported formatVersion ${JSON.stringify(obj.formatVersion)}`);
  }
  if (typeof obj.sessionId !== "string") {
    throw new Error("importSessionFromJSON: missing sessionId");
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error("importSessionFromJSON: missing entries array");
  }

  return {
    sessionId: obj.sessionId,
    metadata: typeof obj.metadata === "object" && obj.metadata !== null ? (obj.metadata as Record<string, unknown>) : {},
    entries: obj.entries as ShotLogEntry[],
  };
}

/** Loads an imported session's entries into a ShotLog -- a fresh in-memory one by default -- so it can be replayed via ReplayShotSource. */
export function loadImportedSessionIntoLog(imported: ImportedSession, log: ShotLog = new ShotLog(createMemoryStore())): ShotLog {
  for (const entry of imported.entries) {
    log.append(entry);
  }
  return log;
}
