/**
 * Playbook loader.
 *
 * Spec: docs/05-playbook.md (categories + weights), docs/08-context-assembly.md §3.
 *
 * The Playbook is manually authored content under $MITABLE_HOME/playbook,
 * organized by category. Each category is a subdirectory; each procedure is
 * a markdown file inside it. Example:
 *
 *   playbook/
 *     incident-investigation/
 *       README.md
 *       production-issue-triage.md
 *       root-cause-analysis.md
 *     deployments/
 *       README.md
 *       deploying-a-new-workflow.md
 *
 * For each work mode (docs/05 §weights), this module returns the playbook
 * entries to surface in a brief. Per docs/08 §3:
 *   - Categories with weight ≥ 5 in the current mode are included
 *   - Prefer the category README (shorter, links downstream)
 *   - Otherwise pick the single most-relevant procedure file (alphabetical for v1)
 *
 * v1 is conservative on inclusion. A real ranker that picks the procedure
 * "most relevant to this customer right now" needs more signal than we
 * have at brief time.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mitableHome, type ProfileField } from "../store/schema.js";
import { PLAYBOOK_CATEGORY_WEIGHTS, type PlaybookCategory, type WorkMode } from "../assembly/work-mode.js";

const MIN_WEIGHT_TO_INCLUDE = 5;
const MAX_BODY_CHARS_PER_ENTRY = 600;

/** Maps PlaybookCategory → on-disk directory name. */
const CATEGORY_DIRS: Record<PlaybookCategory, string> = {
  "Incident Investigation": "incident-investigation",
  "Product Gap Escalation": "product-gap-escalation",
  Deployments: "deployments",
  Evaluations: "evaluations",
  "Renewal Preparation": "renewal-preparation",
  Integrations: "integrations",
  "Customer Onboarding": "customer-onboarding",
};

export interface PlaybookEntry {
  category: PlaybookCategory;
  /** Either the README of the category or a specific procedure. */
  title: string;
  path: string;            // absolute path on disk
  body_excerpt: string;    // truncated for inclusion in briefs
}

export function playbookRoot(): string {
  return join(mitableHome(), "playbook");
}

/**
 * Returns playbook entries to include in the brief for a given mode.
 *
 * profile_fields is the set of fields the brief actually populated — kept
 * for a future ranker that uses field overlap to prefer procedures whose
 * content references the relevant fields. v1 ignores it.
 */
export function loadPlaybookForMode(
  mode: WorkMode,
  _profile_fields: ProfileField[] = [],
): PlaybookEntry[] {
  const root = playbookRoot();
  if (!existsSync(root)) return [];

  const weights = PLAYBOOK_CATEGORY_WEIGHTS[mode];
  const entries: Array<PlaybookEntry & { weight: number }> = [];

  for (const [category, weight] of Object.entries(weights) as Array<[PlaybookCategory, number]>) {
    if (weight < MIN_WEIGHT_TO_INCLUDE) continue;
    const dir = CATEGORY_DIRS[category];
    if (!dir) continue;
    const categoryPath = join(root, dir);
    if (!existsSync(categoryPath)) continue;

    const entry = pickEntryFromCategory(category, categoryPath);
    if (entry) entries.push({ ...entry, weight });
  }

  entries.sort((a, b) => b.weight - a.weight);
  return entries.map(({ weight: _w, ...rest }) => rest);
}

function pickEntryFromCategory(
  category: PlaybookCategory,
  categoryPath: string,
): PlaybookEntry | null {
  // Prefer the category README.
  const readmePath = join(categoryPath, "README.md");
  if (existsSync(readmePath) && statSync(readmePath).isFile()) {
    return makeEntry(category, "README", readmePath);
  }

  // Otherwise pick the first .md file alphabetically.
  let files: string[];
  try {
    files = readdirSync(categoryPath).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return null;
  }
  const first = files[0];
  if (!first) return null;

  const filePath = join(categoryPath, first);
  return makeEntry(category, stripExt(first), filePath);
}

function makeEntry(category: PlaybookCategory, title: string, path: string): PlaybookEntry {
  let body = "";
  try {
    body = readFileSync(path, "utf8");
  } catch {
    body = "";
  }
  return {
    category,
    title,
    path,
    body_excerpt: truncate(body.trim(), MAX_BODY_CHARS_PER_ENTRY),
  };
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 1)}…`;
}

function stripExt(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}
