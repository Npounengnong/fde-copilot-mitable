/**
 * Granola adapter eval (Architecture B).
 *
 * In Architecture B, Claude fetches Granola data via its own MCP and pushes
 * it to Mitable via `ingest_raw_meeting`. Mitable no longer has a REST API
 * adapter or background Granola sweeps.
 *
 * These tests verify:
 *   - classifyNote handles a raw Granola note correctly
 *   - Watermark advances after ingestion
 *   - StubGranolaClient keeps the sweep path exercisable
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("granola-adapter").cleanup;
  const { ensureCustomer } = await import("../../src/store/event-log.js");
  ensureCustomer("carver", "Carver", null);
});

after(() => cleanup?.());

test("classifyNote writes extractions from a raw Granola note", async () => {
  const { classifyNote } = await import("../../src/ingest/classify-note.js");

  // Skip if claude CLI is not available (common in CI / eval runners)
  try {
    const { execSync } = await import("node:child_process");
    execSync("claude --version", { stdio: "ignore" });
  } catch {
    console.log("Skipping: claude CLI not available");
    return;
  }

  const result = await classifyNote({
    customer_id: "carver",
    note: {
      meeting_id: "mtg_001",
      updated_ts: Date.now(),
      title: "Carver Q2 Review",
      body: "The customer reported that the new Zapier polling bridge is now live in production. This was deployed last week to handle document status updates.",
      attendees: ["alice@carver.com"],
    },
    timeout_ms: 120_000,
  });

  assert.equal(result.customer_id, "carver");
  assert.equal(result.meeting_id, "mtg_001");
  // At least one extraction should be written ("Deployed Configuration" or similar)
  assert.ok(result.extractions_written >= 1, `expected at least 1 extraction, got ${result.extractions_written}`);
});

test("watermark advances after ingest_raw_meeting", async () => {
  const { addMeeting, getMeetingWatermark, advanceMeetingWatermark } = await import("../../src/store/granola-map.js");

  addMeeting({
    meeting_id: "mtg_002",
    title: "Test sync",
    customer_id: "carver",
  });

  const before = getMeetingWatermark("mtg_002");
  assert.equal(before.watermark_ts, 0);

  advanceMeetingWatermark("mtg_002", 1234567890000);

  const after = getMeetingWatermark("mtg_002");
  assert.equal(after.watermark_ts, 1234567890000);
});

test("StubGranolaClient sweep returns no new notes", async () => {
  const { sweepGranola } = await import("../../src/ingest/granola.js");
  const { StubGranolaClient } = await import("../../src/ingest/granola-adapter.js");

  const result = await sweepGranola({ client: new StubGranolaClient() });
  assert.equal(result.auth_ok, true);
  assert.equal(result.meetings_with_new, 0);
});

test("CannedGranolaClient drives sweep with a note", async () => {
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
      },
    },
  });

  const result = await sweepGranola({ client, dry_run: true });
  // There may be other meetings from earlier tests; just assert our note was found
  assert.ok(result.meetings_examined >= 1);
  assert.ok(result.meetings_with_new >= 1);
});
