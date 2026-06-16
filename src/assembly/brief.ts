/**
 * Brief assembler.
 *
 * Spec: docs/08-context-assembly.md, docs/06-interaction-model.md §4.
 *
 * Steps:
 *   1. Materialize the customer's current profile from the event log
 *   2. Group by profile_field
 *   3. Apply work-mode weights — sort sections, cap entries per section
 *   4. Render markdown matching the format in docs/06 §4
 *
 * Playbook + Product Manual sections are stubs in this milestone — they'll be
 * populated in milestone 9 (`src/playbook/load.ts`, `src/product/load.ts`).
 */
import { materializeProfile, type EventRow } from "../store/event-log.js";
import { PROFILE_FIELDS, type ProfileField } from "../store/schema.js";
import {
  DEFAULT_MODE,
  PROFILE_FIELD_WEIGHTS,
  entryCapForWeight,
  type WorkMode,
} from "./work-mode.js";

export interface BriefOptions {
  customer_id: string;
  display_name?: string;     // defaults to customer_id if not provided
  mode?: WorkMode;
  as_of?: number;            // unix ms; defaults to "now"
}

export function renderBrief(opts: BriefOptions): string {
  const mode = opts.mode ?? DEFAULT_MODE;
  const displayName = opts.display_name ?? opts.customer_id;
  const rows = materializeProfile(opts.customer_id, opts.as_of);

  if (rows.length === 0) {
    return `# Customer Context: ${displayName}\n\n_Mode: ${mode}_\n\n_No profile entries yet for this customer._\n`;
  }

  const grouped = groupByField(rows);
  const sections = orderedSections(grouped, mode);

  const lines: string[] = [];
  lines.push(`# Customer Context: ${displayName}`);
  lines.push("");
  lines.push(`_Mode: ${mode}_`);
  lines.push("");

  for (const { field, entries } of sections) {
    if (entries.length === 0) continue;
    lines.push(`## ${field}`);
    for (const e of entries) {
      lines.push(formatEntry(e));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function groupByField(rows: EventRow[]): Map<ProfileField, EventRow[]> {
  const groups = new Map<ProfileField, EventRow[]>();
  for (const f of PROFILE_FIELDS) groups.set(f, []);
  for (const row of rows) {
    const bucket = groups.get(row.profile_field as ProfileField);
    if (bucket) bucket.push(row);
  }
  return groups;
}

function orderedSections(
  groups: Map<ProfileField, EventRow[]>,
  mode: WorkMode,
): Array<{ field: ProfileField; entries: EventRow[] }> {
  const weights = PROFILE_FIELD_WEIGHTS[mode];
  const sections: Array<{ field: ProfileField; entries: EventRow[]; weight: number }> = [];
  for (const field of PROFILE_FIELDS) {
    const all = groups.get(field) ?? [];
    if (all.length === 0) continue;
    const weight = weights[field];
    const cap = entryCapForWeight(weight);
    sections.push({ field, entries: all.slice(0, cap), weight });
  }
  sections.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return PROFILE_FIELDS.indexOf(a.field) - PROFILE_FIELDS.indexOf(b.field);
  });
  return sections.map(({ field, entries }) => ({ field, entries }));
}

function formatEntry(e: EventRow): string {
  const date = formatDate(e.origin_ts);
  const meta = `${date} · ${e.source_type} · ${e.provenance}`;
  const head = `- ${e.content} (${meta})`;
  if (e.evidence_text && e.source_type !== "fde_manual") {
    return `${head}\n  Evidence: "${truncateEvidence(e.evidence_text)}"`;
  }
  return head;
}

function formatDate(unixMs: number): string {
  const d = new Date(unixMs);
  return d.toISOString().slice(0, 10);
}

function truncateEvidence(text: string, limit = 240): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1)}…`;
}
