/**
 * Seed the event log from a customer-profile fixture directory.
 *
 * Used to load refs/carver-customer-profile/ into the store for milestone 3's
 * smoke test. Each *.txt file maps to one of the eleven profile fields; the
 * entire file body is recorded as a single fde_manual event with provenance
 * "fde_reported" so it bypasses the evidence-required check.
 *
 * Idempotent at the SCHEMA level (you can re-seed without crashing) but NOT
 * at the row level — each call appends fresh rows. Use a clean MITABLE_HOME
 * for repeatable tests.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { appendEvent, ensureCustomer } from "./event-log.js";
import type { ProfileField } from "./schema.js";

const FILE_TO_FIELD: Record<string, ProfileField> = {
  "01-deployed-configuration": "Deployed Configuration",
  "02-active-workarounds": "Active Workarounds",
  "03-stability-risks": "Stability Risks",
  "04-change-log": "Change Log",
  "05-decision-rationale": "Decision Rationale",
  "06-capability-gaps": "Capability Gaps",
  "07-outcome-metrics": "Outcome Metrics",
  "08-outstanding-commitments": "Outstanding Commitments",
  "09-stakeholder-map": "Stakeholder Map",
  "10-communication-context": "Communication Context",
  "11-commercial-context": "Commercial Context",
};

export interface SeedFixtureInput {
  /** Absolute path to the fixture directory (e.g. refs/carver-customer-profile/). */
  path: string;
  /** Customer ID to assign all entries to. Defaults to the directory basename. */
  customer_id?: string;
  display_name?: string;
}

export interface SeedFixtureResult {
  customer_id: string;
  written: number;
  skipped: Array<{ file: string; reason: string }>;
}

export async function seedFixture(input: SeedFixtureInput): Promise<SeedFixtureResult> {
  const dir = input.path;
  const customerId = input.customer_id ?? inferCustomerId(dir);
  const displayName = input.display_name ?? humanize(customerId);

  ensureCustomer(customerId, displayName, null);

  const files = await readdir(dir);
  const skipped: SeedFixtureResult["skipped"] = [];
  let written = 0;

  for (const file of files) {
    const stem = stripExt(file);
    const field = FILE_TO_FIELD[stem];
    if (!field) {
      skipped.push({ file, reason: "no field mapping" });
      continue;
    }
    const body = (await readFile(join(dir, file), "utf8")).trim();
    if (body === "") {
      skipped.push({ file, reason: "empty file" });
      continue;
    }

    const result = appendEvent({
      customer_id: customerId,
      profile_field: field,
      content: body,
      source_type: "fde_manual",
      source_ref: `fixture:${file}`,
      source_url: null,
      evidence_text: "",
      confidence: 1.0,
      origin_ts: Date.now(),
      provenance: "fde_reported",
    });

    if (result.status === "written") {
      written++;
    } else {
      skipped.push({ file, reason: result.reason });
    }
  }

  return { customer_id: customerId, written, skipped };
}

function inferCustomerId(dir: string): string {
  const base = basename(dir);
  // refs/carver-customer-profile → carver
  const stripped = base.replace(/-customer-profile$/i, "");
  return stripped.toLowerCase();
}

function humanize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function stripExt(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}
