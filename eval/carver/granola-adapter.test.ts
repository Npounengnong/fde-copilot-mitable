/**
 * Granola adapter eval.
 *
 * Tests the real adapter surface against canned data:
 *   - CannedGranolaClient drives the sweep path end-to-end
 *   - RealGranolaClient authPreflight respects the token store
 *   - Attendee-domain customer heuristic resolves correctly
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("granola-adapter").cleanup;
  const { ensureCustomer } = await import("../../src/store/event-log.js");
  ensureCustomer("carver", "Carver", null);
  ensureCustomer("acme", "Acme", null);
});

after(() => cleanup?.());

test("CannedGranolaClient sweeps a mapped meeting end-to-end", async () => {
  const { CannedGranolaClient } = await import("../../src/ingest/granola-adapter.js");
  const { sweepGranola } = await import("../../src/ingest/granola.js");
  const { addMeeting } = await import("../../src/store/granola-map.js");

  addMeeting({
    meeting_id: "not_123",
    title: "Carver kickoff",
    customer_id: "carver",
  });

  const client = new CannedGranolaClient({
    notes: {
      not_123: {
        meeting_id: "not_123",
        updated_ts: Date.now(),
        title: "Carver kickoff",
        body: "We discussed the new integration pipeline.",
        attendees: ["alice@carver.com", "bob@carver.com"],
      },
    },
  });

  const result = await sweepGranola({ client, dry_run: true });
  assert.equal(result.meetings_examined, 1);
  assert.equal(result.meetings_with_new, 1);
  assert.equal(result.auth_ok, true);
});

test("CannedGranolaClient skips notes older than watermark", async () => {
  const { CannedGranolaClient } = await import("../../src/ingest/granola-adapter.js");
  const { sweepGranola } = await import("../../src/ingest/granola.js");
  const { addMeeting } = await import("../../src/store/granola-map.js");

  addMeeting({
    meeting_id: "not_old",
    title: "Old sync",
    customer_id: "carver",
  });

  const oldTs = Date.now() - 86400000 * 30; // 30 days ago
  const client = new CannedGranolaClient({
    notes: {
      not_old: {
        meeting_id: "not_old",
        updated_ts: oldTs,
        title: "Old sync",
        body: "nothing new",
      },
    },
  });

  // After the first sweep, the watermark should be at oldTs.
  // A second sweep should see no new content.
  await sweepGranola({ client, dry_run: true });
  const second = await sweepGranola({ client, dry_run: true });
  assert.equal(second.meetings_with_new, 0);
});

test("RealGranolaClient.authPreflight returns false when no token stored", async () => {
  const { RealGranolaClient } = await import("../../src/ingest/granola-real.js");
  const client = new RealGranolaClient();
  const ok = await client.authPreflight();
  assert.equal(ok, false);
});

test("inferCustomerFromAttendees matches by domain suffix", async () => {
  const { inferCustomerFromAttendees } = await import("../../src/ingest/granola-real.js");
  const result = inferCustomerFromAttendees(["alice@carver.com", "bob@carver.com"]);
  assert.equal(result, "carver");
});

test("inferCustomerFromAttendees returns null when no match", async () => {
  const { inferCustomerFromAttendees } = await import("../../src/ingest/granola-real.js");
  const result = inferCustomerFromAttendees(["alice@unknown.com"]);
  assert.equal(result, null);
});

test("inferCustomerFromAttendees handles plain customer-id domain", async () => {
  const { inferCustomerFromAttendees } = await import("../../src/ingest/granola-real.js");
  const result = inferCustomerFromAttendees(["alice@acme.com"]);
  assert.equal(result, "acme");
});
