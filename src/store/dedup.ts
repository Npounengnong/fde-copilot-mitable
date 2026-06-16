/**
 * Dedup at write time.
 *
 * Spec: docs/07-scan-and-store.md §2.2.
 *
 * v1 ships ONLY Stage 1 (exact hash). Stage 2 (BM25 + cosine + entity
 * overlap) requires an embedding model + retrieval index — meaningful
 * additional infrastructure that belongs in its own milestone. Until then,
 * near-duplicates (paraphrases) will write twice. That's an acceptable
 * v1 tradeoff: a noisier brief is better than holding the whole semantic
 * layer hostage.
 *
 * Stage 1 algorithm:
 *   1. Normalize content (lowercase, collapse whitespace).
 *   2. SHA-256.
 *   3. Look up (customer_id, profile_field, hash) in events.
 *      Hit → reject (and update last_confirmed_at on the existing row).
 *      Miss → caller may proceed to write.
 */
import { createHash } from "node:crypto";
import { openDb } from "./schema.js";
import type { ProfileField } from "./schema.js";

export interface DedupCheckInput {
  customer_id: string;
  profile_field: ProfileField;
  content: string;
}

export type DedupResult =
  | { decision: "write" }
  | { decision: "duplicate"; existing_id: string };

export function normalizeForHash(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

export function contentHash(content: string): string {
  return createHash("sha256").update(normalizeForHash(content)).digest("hex");
}

/**
 * Stage 1 only. Caller passes the result to decide whether to write.
 *
 * Note: there's no `content_hash` column on events — we recompute hashes
 * on the fly when checking. With proper indexing on (customer_id,
 * profile_field) the candidate set is small enough that this is fine for
 * v1. If write volume grows, add a stored hash column and index it.
 */
export function checkDuplicate(input: DedupCheckInput): DedupResult {
  const db = openDb();
  const target = contentHash(input.content);

  const rows = db
    .prepare(
      `SELECT id, content
       FROM events
       WHERE customer_id = @customer_id
         AND profile_field = @profile_field
         AND valid_until IS NULL`,
    )
    .all({
      customer_id: input.customer_id,
      profile_field: input.profile_field,
    }) as Array<{ id: string; content: string }>;

  for (const r of rows) {
    if (contentHash(r.content) === target) {
      db.prepare("UPDATE events SET last_confirmed_at = ? WHERE id = ?").run(Date.now(), r.id);
      return { decision: "duplicate", existing_id: r.id };
    }
  }
  return { decision: "write" };
}
