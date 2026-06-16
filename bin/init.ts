/**
 * One-shot setup. Idempotent — safe to run on every start.
 * Creates the data directory layout described in docs/09-data-model.md.
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MITABLE_HOME = process.env.MITABLE_HOME ?? join(homedir(), ".mitable");

const dirs = [
  MITABLE_HOME,
  join(MITABLE_HOME, "product"),
  join(MITABLE_HOME, "product", "building-blocks"),
  join(MITABLE_HOME, "product", "building-blocks", "configuration-primitives"),
  join(MITABLE_HOME, "product", "building-blocks", "integrations"),
  join(MITABLE_HOME, "product", "building-blocks", "mcp-tools"),
  join(MITABLE_HOME, "product", "pages"),
  join(MITABLE_HOME, "playbook"),
  join(MITABLE_HOME, "customers"),
];

async function main() {
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  process.stderr.write(`[mitable] init complete: ${MITABLE_HOME}\n`);
}

main().catch((err) => {
  process.stderr.write(`[mitable] init failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
