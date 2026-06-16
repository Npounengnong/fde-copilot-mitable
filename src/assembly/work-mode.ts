/**
 * Work-mode field weights.
 *
 * Spec: docs/05-playbook.md, sourced verbatim from refs/Work Mode Context Blueprints.md.
 *
 * Weights are integers 1–10. Higher weight = earlier in the brief, more entries
 * per section, more likely to survive token-budget truncation.
 *
 * v1 ships INVESTIGATE and IMPLEMENT with identical weights. The structure
 * exists so future modes (Scoping, Renewal-Prep, Onboarding) can diverge
 * without changing the assembler.
 */
import type { ProfileField } from "../store/schema.js";

export type WorkMode = "investigate" | "implement";

export const WORK_MODES: readonly WorkMode[] = ["investigate", "implement"];

export const DEFAULT_MODE: WorkMode = "investigate";

const SHARED_PROFILE_WEIGHTS: Record<ProfileField, number> = {
  "Stability Risks": 10,
  "Deployed Configuration": 10,
  "Active Workarounds": 10,
  "Change Log": 7,
  "Decision Rationale": 7,
  "Capability Gaps": 5,
  "Outcome Metrics": 2,
  "Outstanding Commitments": 1,
  "Stakeholder Map": 1,
  "Communication Context": 1,
  "Commercial Context": 1,
};

export const PROFILE_FIELD_WEIGHTS: Record<WorkMode, Record<ProfileField, number>> = {
  investigate: { ...SHARED_PROFILE_WEIGHTS },
  implement: { ...SHARED_PROFILE_WEIGHTS },
};

export type PlaybookCategory =
  | "Incident Investigation"
  | "Product Gap Escalation"
  | "Deployments"
  | "Evaluations"
  | "Renewal Preparation"
  | "Integrations"
  | "Customer Onboarding";

const SHARED_PLAYBOOK_WEIGHTS: Record<PlaybookCategory, number> = {
  "Incident Investigation": 10,
  Deployments: 7,
  Integrations: 5,
  Evaluations: 5,
  "Customer Onboarding": 1,
  "Product Gap Escalation": 1,
  "Renewal Preparation": 1,
};

export const PLAYBOOK_CATEGORY_WEIGHTS: Record<WorkMode, Record<PlaybookCategory, number>> = {
  investigate: { ...SHARED_PLAYBOOK_WEIGHTS },
  implement: { ...SHARED_PLAYBOOK_WEIGHTS },
};

export function weightFor(mode: WorkMode, field: ProfileField): number {
  return PROFILE_FIELD_WEIGHTS[mode][field];
}

/**
 * Soft cap on entries to include per field, given a weight.
 * Rough rule from docs/08-context-assembly.md: ceil(weight * 0.6).
 */
export function entryCapForWeight(weight: number): number {
  return Math.max(1, Math.ceil(weight * 0.6));
}

export function parseMode(input: string | undefined | null): WorkMode {
  if (!input) return DEFAULT_MODE;
  const lower = input.toLowerCase();
  if (lower === "investigate" || lower === "implement") return lower;
  return DEFAULT_MODE;
}
