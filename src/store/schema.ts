/**
 * SQLite schema + connection.
 *
 * Spec: docs/09-data-model.md.
 *
 * The DB file lives at $MITABLE_HOME/events.sqlite. Migrations are versioned
 * via PRAGMA user_version. v1 ships the initial schema only.
 */
import Database, { type Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProfileField =
  | "Deployed Configuration"
  | "Active Workarounds"
  | "Stability Risks"
  | "Change Log"
  | "Decision Rationale"
  | "Capability Gaps"
  | "Outcome Metrics"
  | "Outstanding Commitments"
  | "Stakeholder Map"
  | "Communication Context"
  | "Commercial Context";

export const PROFILE_FIELDS: readonly ProfileField[] = [
  "Deployed Configuration",
  "Active Workarounds",
  "Stability Risks",
  "Change Log",
  "Decision Rationale",
  "Capability Gaps",
  "Outcome Metrics",
  "Outstanding Commitments",
  "Stakeholder Map",
  "Communication Context",
  "Commercial Context",
];

export type Operation = "add" | "supersede" | "remove";
export type SourceType = "slack" | "granola" | "claude_session" | "fde_manual";
export type Provenance =
  | "measured"
  | "customer_reported"
  | "fde_reported"
  | "inferred";

export function mitableHome(): string {
  return process.env.MITABLE_HOME ?? join(homedir(), ".mitable");
}

export function dbPath(): string {
  return join(mitableHome(), "events.sqlite");
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS customers (
  customer_id    TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  one_liner      TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT NOT NULL,
  profile_field     TEXT NOT NULL,
  content           TEXT NOT NULL,

  operation         TEXT NOT NULL,
  source_type       TEXT NOT NULL,
  source_ref        TEXT NOT NULL,
  source_url        TEXT,

  evidence_text     TEXT NOT NULL,
  confidence        REAL NOT NULL,
  origin_ts         INTEGER NOT NULL,
  provenance        TEXT NOT NULL,

  superseded_by     TEXT,
  valid_until       INTEGER,
  last_confirmed_at INTEGER,

  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_customer_field_idx
  ON events(customer_id, profile_field);

CREATE INDEX IF NOT EXISTS events_current_idx
  ON events(customer_id, profile_field)
  WHERE valid_until IS NULL;

CREATE INDEX IF NOT EXISTS events_created_at_idx
  ON events(created_at);

CREATE INDEX IF NOT EXISTS events_origin_ts_idx
  ON events(origin_ts);
`;

let cached: DB | undefined;

export function openDb(): DB {
  if (cached) return cached;
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  cached = db;
  return db;
}

function migrate(db: DB): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const current = row.user_version ?? 0;
  if (current < 1) {
    db.exec(SCHEMA_V1);
    db.pragma("user_version = 1");
  }
}

export function closeDb(): void {
  cached?.close();
  cached = undefined;
}
