/**
 * Profile-shape eval.
 *
 * Seeds the Carver fixture, then asserts:
 *   - All 11 profile fields are populated (one event per field)
 *   - The rendered brief contains every field as a `## <Field>` heading
 *   - The brief starts with the customer header line from docs/06 §4
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("profile-shape").cleanup;
  const { seedFixture } = await import("../../src/store/seed-fixture.js");
  const res = await seedFixture({ path: "refs/carver-customer-profile" });
  assert.equal(res.customer_id, "carver");
  assert.equal(res.written, 11, "Carver fixture should write 11 events (one per field)");
});

after(() => cleanup?.());

test("materialized profile has all 11 fields populated", async () => {
  const { materializeProfile } = await import("../../src/store/event-log.js");
  const { PROFILE_FIELDS } = await import("../../src/store/schema.js");
  const rows = materializeProfile("carver");
  const fieldsSeen = new Set(rows.map((r) => r.profile_field));
  for (const f of PROFILE_FIELDS) {
    assert.ok(fieldsSeen.has(f), `field "${f}" missing from materialized profile`);
  }
});

test("brief starts with the customer header line", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const md = renderBrief({ customer_id: "carver", display_name: "Carver", mode: "investigate" });
  assert.match(md, /^# Customer Context: Carver/);
  assert.match(md, /_Mode: investigate_/);
});

test("brief contains a section for every populated field", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const { PROFILE_FIELDS } = await import("../../src/store/schema.js");
  const md = renderBrief({ customer_id: "carver", mode: "investigate" });
  for (const f of PROFILE_FIELDS) {
    assert.ok(md.includes(`## ${f}`), `expected "## ${f}" section in brief`);
  }
});
