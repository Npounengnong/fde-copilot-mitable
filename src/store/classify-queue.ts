/**
 * Queue of sessions awaiting classification.
 *
 * Spec: docs/06-interaction-model.md §2 (sessionEnd hook).
 *
 * The SessionEnd hook is a fast, fire-and-forget script that drops a row in
 * this table and exits. The actual LLM classification runs later — either via
 * the `drain_classifications` MCP tool (manual) or the sweep scheduler
 * (milestone 6). Decoupling the hook from the LLM call keeps the hook well
 * under Claude Code's hook timeout.
 */
import { openDb } from "./schema.js";

export type QueueStatus = "pending" | "in_progress" | "done" | "failed" | "skipped";

export interface EnqueueInput {
  session_id: string;
  transcript_path?: string | null;
  customer_id_hint?: string | null;
  cwd?: string | null;
}

export interface QueueRow {
  session_id: string;
  transcript_path: string | null;
  customer_id_hint: string | null;
  cwd: string | null;
  queued_at: number;
  status: QueueStatus;
  attempts: number;
  last_error: string | null;
  completed_at: number | null;
}

/**
 * Insert or replace a queue row. If the same session_id ends multiple times,
 * the latest queueing wins (transcript path may have grown / changed CWD).
 */
export function enqueue(input: EnqueueInput): void {
  const db = openDb();
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
}

export function listPending(limit = 20): QueueRow[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT session_id, transcript_path, customer_id_hint, cwd,
              queued_at, status, attempts, last_error, completed_at
       FROM pending_classifications
       WHERE status = 'pending'
       ORDER BY queued_at ASC
       LIMIT ?`,
    )
    .all(limit) as QueueRow[];
}

export function markInProgress(sessionId: string): void {
  const db = openDb();
  db.prepare(
    `UPDATE pending_classifications
     SET status = 'in_progress', attempts = attempts + 1
     WHERE session_id = ?`,
  ).run(sessionId);
}

export function markDone(sessionId: string): void {
  const db = openDb();
  db.prepare(
    `UPDATE pending_classifications
     SET status = 'done', completed_at = ?, last_error = NULL
     WHERE session_id = ?`,
  ).run(Date.now(), sessionId);
}

export function markFailed(sessionId: string, error: string): void {
  const db = openDb();
  db.prepare(
    `UPDATE pending_classifications
     SET status = 'failed', last_error = ?, completed_at = ?
     WHERE session_id = ?`,
  ).run(error, Date.now(), sessionId);
}

export function markSkipped(sessionId: string, reason: string): void {
  const db = openDb();
  db.prepare(
    `UPDATE pending_classifications
     SET status = 'skipped', last_error = ?, completed_at = ?
     WHERE session_id = ?`,
  ).run(reason, Date.now(), sessionId);
}

export function queueCounts(): Record<QueueStatus, number> {
  const db = openDb();
  const rows = db
    .prepare("SELECT status, COUNT(*) as n FROM pending_classifications GROUP BY status")
    .all() as Array<{ status: QueueStatus; n: number }>;
  const out: Record<QueueStatus, number> = {
    pending: 0,
    in_progress: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
