/**
 * add_customer + add_note flow eval.
 *
 * The MCP tools call ensureCustomer + appendEvent under the hood.
 * This test pins the contract those helpers must keep:
 *   - ensureCustomer is idempotent
 *   - appendEvent with fde_manual source writes regardless of evidence_text
 *   - confidence < 0.7 still rejects, even for FDE-authored notes
 *   - The written entry shows up in the brief
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("add-note").cleanup;
});

after(() => cleanup?.());

test("ensureCustomer is idempotent", async () => {
  const { ensureCustomer, listCustomers } = await import("../../src/store/event-log.js");
  ensureCustomer("foo", "Foo Co", null);
  ensureCustomer("foo", "Foo Co", "ignored second call");
  const all = listCustomers();
  const matches = all.filter((c) => c.customer_id === "foo");
  assert.equal(matches.length, 1, "second ensureCustomer should not insert a duplicate row");
});

test("fde_manual note writes through with no evidence_text required", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "foo",
    profile_field: "Stability Risks",
    content: "Database backups have not been verified since launch.",
    source_type: "fde_manual",
    source_ref: `note:${Date.now()}`,
    source_url: null,
    evidence_text: "",
    confidence: 1.0,
    origin_ts: Date.now(),
    provenance: "fde_reported",
  });
  assert.equal(r.status, "written");
});

test("fde_manual note with confidence < 0.7 is still rejected by the gate", async () => {
  const { appendEvent } = await import("../../src/store/event-log.js");
  const r = appendEvent({
    customer_id: "foo",
    profile_field: "Decision Rationale",
    content: "Maybe?",
    source_type: "fde_manual",
    source_ref: `note:${Date.now()}`,
    source_url: null,
    evidence_text: "",
    confidence: 0.5,
    origin_ts: Date.now(),
    provenance: "fde_reported",
  });
  assert.equal(r.status, "rejected");
  if (r.status === "rejected") assert.equal(r.reason, "low_confidence");
});

test("note appears in the rendered brief", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const md = renderBrief({ customer_id: "foo", mode: "investigate" });
  assert.match(md, /Database backups have not been verified since launch\./);
});
