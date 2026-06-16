/**
 * Event log writer + materialized-view query.
 *
 * Spec: docs/07-scan-and-store.md §2.1, docs/09-data-model.md.
 *
 * Invariants enforced here:
 *   - confidence >= 0.7 (docs §2.3 — the gate)
 *   - evidence_text required unless source_type === "fde_manual"
 *   - append-only: no UPDATE of content/evidence_text. Corrections write a new row
 *     with operation="supersede" and call markSuperseded() on the old row.
 *
 * Dedup, semantic similarity, and per-field conflict policy live in separate
 * modules (milestone 5). v1 of this writer is intentionally thin: append + read.
 */
import { ulid } from "ulid";
import { openDb, type Operation, type Provenance, type SourceType, type ProfileField } from "./schema.js";
import { checkDuplicate } from "./dedup.js";

const CONFIDENCE_GATE = 0.7;

export interface AppendInput {
  customer_id: string;
  profile_field: ProfileField;
  content: string;
  operation?: Operation;          // defaults to "add"
  source_type: SourceType;
  source_ref: string;
  source_url?: string | null;
  evidence_text: string;
  confidence: number;
  origin_ts: number;              // unix ms
  provenance: Provenance;
}

export interface EventRow {
  id: string;
  customer_id: string;
  profile_field: ProfileField;
  content: string;
  operation: Operation;
  source_type: SourceType;
  source_ref: string;
  source_url: string | null;
  evidence_text: string;
  confidence: number;
  origin_ts: number;
  provenance: Provenance;
  superseded_by: string | null;
  valid_until: number | null;
  last_confirmed_at: number | null;
  created_at: number;
}

export type AppendResult =
  | { status: "written"; id: string }
  | { status: "rejected"; reason: "low_confidence" | "missing_evidence" | "duplicate"; existing_id?: string };

export function appendEvent(input: AppendInput): AppendResult {
  if (input.confidence < CONFIDENCE_GATE) {
    return { status: "rejected", reason: "low_confidence" };
  }
  if (input.source_type !== "fde_manual" && input.evidence_text.trim() === "") {
    return { status: "rejected", reason: "missing_evidence" };
  }

  // Stage 1 dedup (exact-hash). Skipped for fde_manual writes so re-seeding a
  // fixture is idempotent at the SCHEMA level only (existing rows aren't
  // duplicated, but they ARE still written if hashes match).
  if (input.source_type !== "fde_manual") {
    const dup = checkDuplicate({
      customer_id: input.customer_id,
      profile_field: input.profile_field,
      content: input.content,
    });
    if (dup.decision === "duplicate") {
      return { status: "rejected", reason: "duplicate", existing_id: dup.existing_id };
    }
  }

  const db = openDb();
  const id = ulid();
  const now = Date.now();

  db.prepare(
    `INSERT INTO events (
      id, customer_id, profile_field, content,
      operation, source_type, source_ref, source_url,
      evidence_text, confidence, origin_ts, provenance,
      superseded_by, valid_until, last_confirmed_at, created_at
    ) VALUES (
      @id, @customer_id, @profile_field, @content,
      @operation, @source_type, @source_ref, @source_url,
      @evidence_text, @confidence, @origin_ts, @provenance,
      NULL, NULL, NULL, @created_at
    )`,
  ).run({
    id,
    customer_id: input.customer_id,
    profile_field: input.profile_field,
    content: input.content,
    operation: input.operation ?? "add",
    source_type: input.source_type,
    source_ref: input.source_ref,
    source_url: input.source_url ?? null,
    evidence_text: input.evidence_text,
    confidence: input.confidence,
    origin_ts: input.origin_ts,
    provenance: input.provenance,
    created_at: now,
  });

  return { status: "written", id };
}

export function markSuperseded(oldId: string, newId: string): void {
  const db = openDb();
  db.prepare(
    `UPDATE events
     SET valid_until = @now, superseded_by = @newId
     WHERE id = @oldId AND valid_until IS NULL`,
  ).run({ now: Date.now(), newId, oldId });
}

/**
 * Current materialized profile for a customer.
 *
 * Spec: docs/09-data-model.md — "Materialized profile view".
 */
export function materializeProfile(customerId: string, asOf?: number): EventRow[] {
  const db = openDb();
  const t = asOf ?? Number.MAX_SAFE_INTEGER;
  return db
    .prepare(
      `SELECT * FROM events
       WHERE customer_id = @customer_id
         AND created_at <= @t
         AND (valid_until IS NULL OR valid_until > @t)
         AND operation != 'remove'
       ORDER BY profile_field ASC, origin_ts DESC, created_at DESC`,
    )
    .all({ customer_id: customerId, t }) as EventRow[];
}

export function ensureCustomer(customerId: string, displayName: string, oneLiner?: string | null): void {
  const db = openDb();
  db.prepare(
    `INSERT INTO customers (customer_id, display_name, one_liner, created_at)
     VALUES (@id, @name, @one_liner, @now)
     ON CONFLICT(customer_id) DO NOTHING`,
  ).run({
    id: customerId,
    name: displayName,
    one_liner: oneLiner ?? null,
    now: Date.now(),
  });
}

export function listCustomers(): Array<{ customer_id: string; display_name: string; one_liner: string | null }> {
  const db = openDb();
  return db
    .prepare("SELECT customer_id, display_name, one_liner FROM customers ORDER BY display_name")
    .all() as Array<{ customer_id: string; display_name: string; one_liner: string | null }>;
}
