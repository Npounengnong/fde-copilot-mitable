/**
 * Example-customer fixture eval.
 *
 * Verifies the public example fixture loads cleanly and produces a
 * renderable brief — the same first-run path a brand new user gets via
 * /mitable-get-started.
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("acme-bakery").cleanup;
  const { seedFixture } = await import("../../src/store/seed-fixture.js");
  const res = await seedFixture({ path: "examples/acme-bakery" });
  assert.equal(res.customer_id, "acme-bakery");
  assert.equal(res.written, 11);
});

after(() => cleanup?.());

test("example fixture writes events for all 11 fields", async () => {
  const { materializeProfile } = await import("../../src/store/event-log.js");
  const { PROFILE_FIELDS } = await import("../../src/store/schema.js");
  const rows = materializeProfile("acme-bakery");
  const fields = new Set(rows.map((r) => r.profile_field));
  for (const f of PROFILE_FIELDS) {
    assert.ok(fields.has(f), `example fixture missing field: ${f}`);
  }
});

test("brief renders against the example customer", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const md = renderBrief({ customer_id: "acme-bakery", mode: "investigate" });
  assert.match(md, /^# Customer Context:/);
  // Confirm distinctive body content shows up — proves the fixture wasn't empty.
  assert.match(md, /allergy|bakery|allergen/i, "example body content should appear in the brief");
});
