#!/usr/bin/env node
/**
 * SessionEnd hook.
 *
 * Spec: docs/06-interaction-model.md §2.
 *
 * Claude Code invokes this with `{session_id, conversation_id}` on stdin.
 * Hooks must exit quickly (well under the 10s timeout) and cannot call LLMs
 * synchronously, so this script does the minimum:
 *
 *   1. Parse stdin
 *   2. Locate the transcript file Claude Code stored for this session
 *   3. Apply the noise filter (< 4 turns or < 2 minutes → skip)
 *   4. Enqueue a row in pending_classifications
 *   5. Exit 0
 *
 * The actual LLM classification is done later by drain_classifications
 * (MCP tool, or the scheduler in milestone 6). This separation is the
 * pattern from the Vercel plugin's session-end hook.
 *
 * .mjs because hooks run via `node` directly with no TS toolchain in scope.
 * Keep this file dependency-free (only better-sqlite3, which the plugin
 * already depends on).
 */
import { readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const MIN_TURNS = 4;
const MIN_DURATION_MS = 2 * 60 * 1000;

function mitableHome() {
  return process.env.MITABLE_HOME ?? join(homedir(), ".mitable");
}

function readStdin() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    // No stdin → nothing to do.
  }
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findTranscriptPath(sessionId, cwd) {
  // Claude Code stores transcripts at ~/.claude/projects/<project-slug>/<session_id>.jsonl
  // The project slug is derived from the absolute cwd. We search for the matching
  // file rather than reconstructing the slug — both more robust and self-contained.
  const projectsRoot = join(homedir(), ".claude", "projects");
  let projectDirs;
  try {
    projectDirs = readdirSync(projectsRoot);
  } catch {
    return null;
  }
  for (const dir of projectDirs) {
    const candidate = join(projectsRoot, dir, `${sessionId}.jsonl`);
    try {
      const st = statSync(candidate);
      if (st.isFile()) return candidate;
    } catch {
      // Not in this project dir; continue.
    }
  }
  // Fall back: if cwd is provided, try the most-recently-modified jsonl in the matching dir.
  if (cwd) {
    const slug = cwd.replace(/[/.]/g, "-").replace(/^-+/, "-");
    const dir = join(projectsRoot, slug);
    try {
      const candidate = join(dir, `${sessionId}.jsonl`);
      const st = statSync(candidate);
      if (st.isFile()) return candidate;
    } catch {
      // Continue.
    }
  }
  return null;
}

/**
 * Cheap noise check before we even queue.
 * Counts user-turn lines and measures (last - first) timestamp gap.
 * Returns { ok: true } or { ok: false, reason }.
 */
function noiseCheck(transcriptPath) {
  if (!transcriptPath) return { ok: true }; // can't measure → defer to classifier
  let body;
  try {
    body = readFileSync(transcriptPath, "utf8");
  } catch {
    return { ok: true };
  }
  const lines = body.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, reason: "empty_transcript" };

  let userTurns = 0;
  let firstTs = null;
  let lastTs = null;

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      const ts = typeof msg.timestamp === "string" ? Date.parse(msg.timestamp) : null;
      if (ts && Number.isFinite(ts)) {
        if (firstTs === null) firstTs = ts;
        lastTs = ts;
      }
      if (msg.type === "user" || msg.role === "user") userTurns++;
    } catch {
      // Skip malformed lines.
    }
  }

  if (userTurns < MIN_TURNS) return { ok: false, reason: `low_turns:${userTurns}` };
  if (firstTs !== null && lastTs !== null && lastTs - firstTs < MIN_DURATION_MS) {
    return { ok: false, reason: `short_duration:${lastTs - firstTs}` };
  }
  return { ok: true };
}

function enqueueViaSqlite(input) {
  const sqlitePath = join(mitableHome(), "events.sqlite");
  mkdirSync(dirname(sqlitePath), { recursive: true });

  // Lazy require — keeps the hook lean if it has nothing to do.
  const Database = require("better-sqlite3");
  const db = new Database(sqlitePath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);

    db.prepare(
      `INSERT INTO pending_classifications
         (session_id, transcript_path, customer_id_hint, cwd, queued_at, status, attempts)
       VALUES (@id, @path, @hint, @cwd, @now, 'pending', 0)
       ON CONFLICT(session_id) DO UPDATE SET
         transcript_path = excluded.transcript_path,
         customer_id_hint = excluded.customer_id_hint,
         cwd = excluded.cwd,
         queued_at = excluded.queued_at,
         status = 'pending',
         last_error = NULL`,
    ).run({
      id: input.session_id,
      path: input.transcript_path ?? null,
      hint: input.customer_id_hint ?? null,
      cwd: input.cwd ?? null,
      now: Date.now(),
    });
  } finally {
    db.close();
  }
}

/**
 * The hook can run before src/mcp/server.ts has ever opened the DB in this
 * MITABLE_HOME (e.g. if the user never invoked /mitable yet). We can't import
 * the TS migration helpers from a .mjs script without tsx, so we mirror the
 * minimum schema needed for the queue here. This is deliberate duplication
 * — the canonical schema lives in src/store/schema.ts and the MCP server
 * will run the proper migrations on its next startup.
 */
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_classifications (
      session_id        TEXT PRIMARY KEY,
      transcript_path   TEXT,
      customer_id_hint  TEXT,
      cwd               TEXT,
      queued_at         INTEGER NOT NULL,
      status            TEXT NOT NULL,
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT,
      completed_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS pending_classifications_status_idx
      ON pending_classifications(status, queued_at);
  `);
}

function main() {
  const payload = readStdin();
  if (!payload) {
    // Nothing usable — be quiet, exit clean.
    process.exit(0);
  }
  const sessionId =
    (typeof payload.session_id === "string" && payload.session_id) ||
    (typeof payload.conversation_id === "string" && payload.conversation_id) ||
    null;
  if (!sessionId) {
    process.exit(0);
  }

  const cwd = process.cwd();
  const transcriptPath = findTranscriptPath(sessionId, cwd);

  const noise = noiseCheck(transcriptPath);
  if (!noise.ok) {
    // Don't even enqueue noisy sessions.
    process.stderr.write(`[mitable] sessionEnd skipped: ${noise.reason}\n`);
    process.exit(0);
  }

  try {
    enqueueViaSqlite({ session_id: sessionId, transcript_path: transcriptPath, cwd });
    process.stderr.write(`[mitable] queued session ${sessionId.slice(0, 8)} for classification\n`);
  } catch (err) {
    // Never crash the hook — Claude Code logs stderr but allows the operation.
    process.stderr.write(`[mitable] sessionEnd enqueue failed: ${err?.message ?? err}\n`);
  }

  process.exit(0);
}

main();
