/**
 * Work-mode eval.
 *
 * Confirms the brief uses the Work Mode Context Blueprints weights from
 * docs/05-playbook.md. Specifically: high-weight fields appear before
 * low-weight fields in section order.
 *
 * v1: INVESTIGATE and IMPLEMENT have identical weights (per the blueprints),
 * so ordering is the same. The test still pins that the ORDER itself matches
 * the weights, so any future divergence is caught.
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { useEphemeralMitableHome } from "../_helpers.js";

let cleanup: () => void;

before(async () => {
  cleanup = useEphemeralMitableHome("work-mode").cleanup;
  const { seedFixture } = await import("../../src/store/seed-fixture.js");
  await seedFixture({ path: "refs/carver-customer-profile" });
});

after(() => cleanup?.());

function sectionOrder(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      // The brief's own section headers come BEFORE any sub-headings the
      // fixture body might contain. We only care about the top-level brief
      // sections, which match the eleven profile-field names.
      const heading = line.slice(3).trim();
      out.push(heading);
    }
  }
  return out;
}

test("INVESTIGATE: high-weight fields come before low-weight fields", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const md = renderBrief({ customer_id: "carver", mode: "investigate" });
  const order = sectionOrder(md);

  // Pick the brief-level field headings only.
  const FIELDS = [
    "Deployed Configuration",
    "Active Workarounds",
    "Stability Risks",
    "Change Log",
    "Decision Rationale",
    "Capability Gaps",
    "Outcome Metrics",
    "Outstanding Commitments",
    "Stakeholder Map",
    "Communication Context",
    "Commercial Context",
  ];
  const indices = new Map<string, number>();
  for (const f of FIELDS) {
    const idx = order.indexOf(f);
    assert.ok(idx >= 0, `section "${f}" missing from brief`);
    indices.set(f, idx);
  }

  // Each weight-10 field must appear before each weight-7 field, etc.
  const w10 = ["Deployed Configuration", "Active Workarounds", "Stability Risks"];
  const w7 = ["Change Log", "Decision Rationale"];
  const w2 = ["Outcome Metrics"];
  const w1 = ["Outstanding Commitments", "Stakeholder Map", "Communication Context", "Commercial Context"];

  for (const hi of w10) for (const lo of w7) assert.ok((indices.get(hi)!) < (indices.get(lo)!), `${hi} should be before ${lo}`);
  for (const hi of w7) for (const lo of w2) assert.ok((indices.get(hi)!) < (indices.get(lo)!), `${hi} should be before ${lo}`);
  for (const hi of w2) for (const lo of w1) assert.ok((indices.get(hi)!) < (indices.get(lo)!), `${hi} should be before ${lo}`);
});

test("IMPLEMENT mode produces the same field ordering as INVESTIGATE (v1 has shared weights)", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const inv = sectionOrder(renderBrief({ customer_id: "carver", mode: "investigate" }));
  const impl = sectionOrder(renderBrief({ customer_id: "carver", mode: "implement" }));
  assert.deepEqual(inv, impl, "v1 has shared weights between modes; future divergence will fail this");
});

test("mode header is rendered correctly", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const inv = renderBrief({ customer_id: "carver", mode: "investigate" });
  const impl = renderBrief({ customer_id: "carver", mode: "implement" });
  assert.match(inv, /_Mode: investigate_/);
  assert.match(impl, /_Mode: implement_/);
});
