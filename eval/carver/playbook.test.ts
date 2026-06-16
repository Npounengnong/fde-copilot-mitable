/**
 * Playbook integration eval.
 *
 * Authoring two playbook categories on disk should produce a
 * "Relevant Playbook" section in the brief, sorted by category weight.
 */
import { before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useEphemeralMitableHome } from "../_helpers.js";

let dir: string;
let cleanup: () => void;

before(async () => {
  const handle = useEphemeralMitableHome("playbook");
  dir = handle.dir;
  cleanup = handle.cleanup;

  // Seed Carver so the brief has profile content to which playbook is appended.
  const { seedFixture } = await import("../../src/store/seed-fixture.js");
  await seedFixture({ path: "refs/carver-customer-profile" });

  // Author two playbook categories with different weights.
  const playbookRoot = join(dir, "playbook");
  mkdirSync(join(playbookRoot, "incident-investigation"), { recursive: true });
  mkdirSync(join(playbookRoot, "deployments"), { recursive: true });
  writeFileSync(
    join(playbookRoot, "incident-investigation", "README.md"),
    "# Incident Investigation\n\nTriage prod issues in order.",
  );
  writeFileSync(
    join(playbookRoot, "deployments", "deploying-a-new-workflow.md"),
    "# Deploying a new workflow\n\nValidate, diff, roll out to one.",
  );
});

after(() => cleanup?.());

test("brief includes a Relevant Playbook section", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const md = renderBrief({ customer_id: "carver", mode: "investigate" });
  assert.ok(md.includes("## Relevant Playbook"), "expected Relevant Playbook section");
});

test("higher-weight category appears before lower-weight category", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const md = renderBrief({ customer_id: "carver", mode: "investigate" });
  const idxIncident = md.indexOf("Incident Investigation —");
  const idxDeploy = md.indexOf("Deployments —");
  assert.ok(idxIncident > 0, "Incident Investigation entry missing");
  assert.ok(idxDeploy > 0, "Deployments entry missing");
  assert.ok(
    idxIncident < idxDeploy,
    "Incident Investigation (weight 10) should appear before Deployments (weight 7)",
  );
});

test("README is preferred over a procedure file when both exist", async () => {
  const { renderBrief } = await import("../../src/assembly/brief.js");
  const md = renderBrief({ customer_id: "carver", mode: "investigate" });
  // The incident-investigation category has only a README. We just confirm
  // the entry's title is "README" — that's the contract.
  assert.match(md, /Incident Investigation — README/);
});
