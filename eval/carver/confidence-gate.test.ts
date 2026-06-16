/**
 * Confidence-gate + evidence-required eval.
 *
 * Per docs/07 §2.3, writes with confidence < 0.7 are rejected.
 * Per docs/07 §1.7 / §2.1, non-fde_manual writes require evidence_text.
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("confidence").cleanup;
  const { ensureCustomer } = await import("../../src/store/event-log.js");
  ensureCustomer("acme", "Acme", null);
});

after(() => cleanup?.());

test("confidence < 0.7 is rejected", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "acme",
    profile_field: "Stability Risks",
    content: "Borderline-confidence claim",
    source_type: "slack",
    source_ref: "C001:1.1",
    source_url: null,
    evidence_text: "evidence here",
    confidence: 0.65,
    origin_ts: Date.now(),
    provenance: "customer_reported",
  });
  assert.equal(r.status, "rejected");
  if (r.status === "rejected") assert.equal(r.reason, "low_confidence");
});

test("confidence === 0.7 is allowed", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "acme",
    profile_field: "Stability Risks",
    content: "Edge-of-gate claim",
    source_type: "slack",
    source_ref: "C001:1.2",
    source_url: null,
    evidence_text: "evidence here",
    confidence: 0.7,
    origin_ts: Date.now(),
    provenance: "customer_reported",
  });
  assert.equal(r.status, "written");
});

test("missing evidence on a non-fde source is rejected", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "acme",
    profile_field: "Decision Rationale",
    content: "Decision without evidence",
    source_type: "slack",
    source_ref: "C001:1.3",
    source_url: null,
    evidence_text: "",
    confidence: 0.95,
    origin_ts: Date.now(),
    provenance: "customer_reported",
  });
  assert.equal(r.status, "rejected");
  if (r.status === "rejected") assert.equal(r.reason, "missing_evidence");
});

test("missing evidence is allowed for fde_manual writes (the seeder uses this)", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "acme",
    profile_field: "Communication Context",
    content: "FDE-asserted style note",
    source_type: "fde_manual",
    source_ref: "fde:cli",
    source_url: null,
    evidence_text: "",
    confidence: 1.0,
    origin_ts: Date.now(),
    provenance: "fde_reported",
  });
  assert.equal(r.status, "written");
});
