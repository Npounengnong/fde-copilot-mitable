/**
 * Dedup-stage-1 eval.
 *
 * Confirms the exact-hash dedup contract from docs/07 §2.2:
 *   - Second identical write is rejected
 *   - Whitespace + case differences still count as duplicates
 *   - A genuinely different content writes successfully
 *   - The check is scoped to (customer_id, profile_field) — same content
 *     in a different field is NOT a duplicate
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("dedup").cleanup;
  const { ensureCustomer } = await import("../../src/store/event-log.js");
  ensureCustomer("acme", "Acme", null);
});

after(() => cleanup?.());

test("second identical write is rejected as duplicate", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const base = {
    customer_id: "acme",
    profile_field: "Active Workarounds" as const,
    content: "Zapier polling bridge added for document status.",
    source_type: "slack" as const,
    source_ref: "C999:1718.0001",
    source_url: null,
    evidence_text: "Zapier polling bridge added for document status.",
    confidence: 0.9,
    origin_ts: Date.now(),
    provenance: "customer_reported" as const,
  };

  const a = appendEvent(base);
  assert.equal(a.status, "written");
  if (a.status !== "written") return;

  const b = appendEvent({ ...base, source_ref: "C999:1718.0002" });
  assert.equal(b.status, "rejected");
  if (b.status !== "rejected") return;
  assert.equal(b.reason, "duplicate");
  assert.equal(b.existing_id, a.id);
});

test("whitespace + case variants are still duplicates", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "acme",
    profile_field: "Active Workarounds",
    content: "  ZAPIER polling bridge added for document   status.  ",
    source_type: "slack",
    source_ref: "C999:1718.0003",
    source_url: null,
    evidence_text: "case-insensitive match",
    confidence: 0.9,
    origin_ts: Date.now(),
    provenance: "customer_reported",
  });
  assert.equal(r.status, "rejected");
  if (r.status === "rejected") assert.equal(r.reason, "duplicate");
});

test("genuinely different content writes successfully", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "acme",
    profile_field: "Active Workarounds",
    content: "Lookup cap deployed at 500 SKUs.",
    source_type: "slack",
    source_ref: "C999:1718.0004",
    source_url: null,
    evidence_text: "Lookup cap deployed at 500 SKUs.",
    confidence: 0.9,
    origin_ts: Date.now(),
    provenance: "customer_reported",
  });
  assert.equal(r.status, "written");
});

test("dedup is scoped to (customer_id, profile_field) — same content in a different field is NOT a duplicate", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "acme",
    profile_field: "Stability Risks",
    content: "Zapier polling bridge added for document status.",
    source_type: "slack",
    source_ref: "C999:1718.0005",
    source_url: null,
    evidence_text: "Same content but a different field.",
    confidence: 0.9,
    origin_ts: Date.now(),
    provenance: "customer_reported",
  });
  assert.equal(r.status, "written");
});
