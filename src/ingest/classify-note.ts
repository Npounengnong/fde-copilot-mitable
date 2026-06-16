/**
 * Granola-note classifier.
 *
 * Spec: docs/07-scan-and-store.md §1.6–§1.8.
 *
 * Same pattern as the Slack-thread and session-transcript classifiers:
 *   - Spawn `claude -p` with a strict-JSON system prompt
 *   - Require verbatim evidence_text per extraction
 *   - Hand parsed rows to appendEvent — confidence gate + dedup happen there
 *
 * Granola-specific:
 *   - source_type = "granola"
 *   - source_ref = "meeting:<meeting_id>"
 *   - source_url = note permalink, if known
 *   - origin_ts = the note's updated_ts (the meeting moment)
 *   - provenance = "customer_reported" (meeting notes are conversation
 *     transcripts of customer-facing time)
 */
import { spawn } from "node:child_process";
import { appendEvent } from "../store/event-log.js";
import { PROFILE_FIELDS, type ProfileField } from "../store/schema.js";
import type { GranolaNote } from "./granola-adapter.js";

export interface NoteClassifyInput {
  customer_id: string;
  note: GranolaNote;
  claude_bin?: string;
  timeout_ms?: number;
}

export interface NoteClassifyResult {
  meeting_id: string;
  customer_id: string;
  extractions_written: number;
  extractions_rejected: number;
  rejections: Array<{ field: string; reason: string }>;
}

interface RawExtraction {
  profile_field: string;
  content: string;
  evidence_text: string;
  confidence: number;
}
interface ParsedOutput {
  extractions: RawExtraction[];
}

const SYSTEM_PROMPT = `
You extract customer-profile updates from a meeting note recorded in Granola.

You will receive a Granola note as JSON (meeting_id, title, body, optional attendees).
The body is the captured / summarised meeting content. Treat statements made by the
customer with more weight than internal-team commentary, but extract from either when
the signal is clear.

Map signals to the eleven profile fields below. ONE note can produce multiple
extractions. Each extraction goes to exactly ONE field — pick the strongest match.

Field-to-signal table:

- "Deployed Configuration"   — what is actually running in production now
- "Active Workarounds"       — temporary patches currently in place
- "Stability Risks"          — known fragility, failure conditions
- "Change Log"               — a specific change that was made (with date if visible)
- "Decision Rationale"       — WHY a choice was made, with the constraint
- "Capability Gaps"          — something the product can't do for this customer
- "Outcome Metrics"          — a measured number/rate/percentage
- "Outstanding Commitments"  — a promise, action item, or due date
- "Stakeholder Map"          — a person, role, or relationship dynamic
- "Communication Context"    — terminology, tone, sensitivities for this account
- "Commercial Context"       — contract, renewal, expansion, ACV

RULES:

1. For EVERY extraction you MUST quote the verbatim text passage from the note body
   that supports it in "evidence_text". No paraphrasing. If you can't quote, do not
   extract.

2. Confidence is 0.0–1.0. The write threshold is 0.7. Anything you're less than 70%
   sure of, mark below 0.7 — it will be dropped, which is correct behavior.

3. Pleasantries, agenda lines, and "next time we'll discuss X" are NOT extractions.
   Only extract claims with substance.

4. Distill content to a single self-contained sentence.

OUTPUT — strict JSON, no markdown fences, no commentary:

{
  "extractions": [
    {
      "profile_field": "<one of the eleven exact strings>",
      "content": "<one-sentence assertion>",
      "evidence_text": "<verbatim quote from the note body>",
      "confidence": 0.85
    }
  ]
}

If nothing in the note is worth extracting, return {"extractions": []}.
`.trim();

export async function classifyNote(input: NoteClassifyInput): Promise<NoteClassifyResult> {
  const raw = await runClaudeP({
    bin: input.claude_bin ?? "claude",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input.note),
    timeoutMs: input.timeout_ms ?? 120_000,
  });
  const parsed = parseOutput(raw);
  return writeExtractions(input, parsed);
}

function buildUserPrompt(note: GranolaNote): string {
  return [
    "Classify this Granola meeting note. Return strict JSON per the system prompt.",
    "",
    "=== NOTE ===",
    JSON.stringify(
      {
        meeting_id: note.meeting_id,
        title: note.title,
        attendees: note.attendees ?? [],
        body: note.body,
      },
      null,
      2,
    ),
    "=== END NOTE ===",
  ].join("\n");
}

interface RunOpts {
  bin: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}

async function runClaudeP(opts: RunOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--system-prompt", opts.systemPrompt, "--output-format", "text"];
    const child = spawn(opts.bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude -p timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout.on("data", (b) => {
      stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(opts.userPrompt);
    child.stdin.end();
  });
}

function parseOutput(raw: string): ParsedOutput {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(stripped);
  } catch {
    throw new Error(`classifier produced non-JSON output (first 300 chars): ${stripped.slice(0, 300)}`);
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("classifier output was not a JSON object");
  }
  const cast = obj as Partial<ParsedOutput>;
  return {
    extractions: Array.isArray(cast.extractions) ? cast.extractions.filter(isValidRaw) : [],
  };
}

function isValidRaw(x: unknown): x is RawExtraction {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<RawExtraction>;
  return (
    typeof r.profile_field === "string" &&
    typeof r.content === "string" &&
    typeof r.evidence_text === "string" &&
    typeof r.confidence === "number"
  );
}

function writeExtractions(input: NoteClassifyInput, out: ParsedOutput): NoteClassifyResult {
  const rejections: NoteClassifyResult["rejections"] = [];
  let written = 0;

  const allowed = new Set<string>(PROFILE_FIELDS);
  const sourceRef = `meeting:${input.note.meeting_id}`;
  const sourceUrl = input.note.permalink ?? null;
  const originMs = input.note.updated_ts;

  for (const ex of out.extractions) {
    if (!allowed.has(ex.profile_field)) {
      rejections.push({ field: ex.profile_field, reason: "unknown_field" });
      continue;
    }
    const result = appendEvent({
      customer_id: input.customer_id,
      profile_field: ex.profile_field as ProfileField,
      content: ex.content,
      source_type: "granola",
      source_ref: sourceRef,
      source_url: sourceUrl,
      evidence_text: ex.evidence_text,
      confidence: ex.confidence,
      origin_ts: Number.isFinite(originMs) ? originMs : Date.now(),
      provenance: "customer_reported",
    });
    if (result.status === "written") {
      written++;
    } else {
      rejections.push({ field: ex.profile_field, reason: result.reason });
    }
  }
  return {
    meeting_id: input.note.meeting_id,
    customer_id: input.customer_id,
    extractions_written: written,
    extractions_rejected: rejections.length,
    rejections,
  };
}
