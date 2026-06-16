/**
 * Transcript classifier.
 *
 * Spec: docs/07-scan-and-store.md §1.6–§1.8.
 *
 * Reads a Claude Code transcript (.jsonl), spawns `claude -p` with a strict
 * classification prompt, and returns structured extractions ready for the
 * event log. Per the spec:
 *   - Every extraction MUST carry a verbatim evidence_text quote
 *   - Confidence < 0.7 is dropped at write time (in appendEvent)
 *   - source_type is always "claude_session" for these extractions
 *   - provenance is "measured" because Claude observed the work directly
 *
 * The classifier prompt instructs claude -p to return strict JSON. We parse
 * defensively and return whatever validates — partial parses are better than
 * none, but malformed lines are dropped, not patched.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { appendEvent } from "../store/event-log.js";
import { PROFILE_FIELDS, type ProfileField } from "../store/schema.js";

export interface ClassifyInput {
  session_id: string;
  transcript_path: string;
  customer_id: string;          // resolved before calling — see resolveCustomer()
  claude_bin?: string;           // override for tests; defaults to "claude"
  timeout_ms?: number;           // total budget; defaults to 120_000
}

export interface ClassifyResult {
  session_id: string;
  customer_id: string;
  task_type: string | null;
  outcome: string | null;
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

interface ClassifyOutput {
  task_type: string | null;
  outcome: string | null;
  extractions: RawExtraction[];
}

const SYSTEM_PROMPT = `
You classify Claude Code session transcripts into structured customer-profile updates.

You will receive a transcript (JSON Lines, one message per line). Your job:

1. Identify the task type performed in this session — one of:
   Debugging, Configuration, Scoping, Investigation, Deployment, Eval, Other

2. Identify the outcome — one of:
   Resolved, In Progress, Blocked, Inconclusive

3. Extract any high-confidence updates to the customer's profile. Each extraction maps
   to exactly ONE of the following eleven profile fields:

   ${PROFILE_FIELDS.map((f) => `- ${f}`).join("\n   ")}

   The field-to-signal table (use this to decide which field an extraction belongs in):

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

4. For EVERY extraction, you MUST quote the verbatim passage from the transcript
   that supports it in "evidence_text". No paraphrasing. If you can't quote, don't extract.

5. Confidence is 0.0–1.0. Be ruthless: 0.7 is the write threshold. Anything you're
   less than 70% sure of, mark below 0.7 (it will be dropped) — that's correct behavior.

OUTPUT FORMAT — strict JSON, no markdown fences, no prose:

{
  "task_type": "Debugging" | "Configuration" | "Scoping" | "Investigation" | "Deployment" | "Eval" | "Other" | null,
  "outcome": "Resolved" | "In Progress" | "Blocked" | "Inconclusive" | null,
  "extractions": [
    {
      "profile_field": "<one of the eleven exact strings above>",
      "content": "<one-sentence self-contained assertion>",
      "evidence_text": "<verbatim quote from transcript>",
      "confidence": 0.85
    }
  ]
}

If nothing is worth extracting, return {"task_type": ..., "outcome": ..., "extractions": []}.
Never invent. Never include extractions without quoted evidence.
`.trim();

export async function classifyTranscript(input: ClassifyInput): Promise<ClassifyResult> {
  const transcript = await readFile(input.transcript_path, "utf8");
  const userPrompt = buildUserPrompt(transcript);

  const raw = await runClaudeP({
    bin: input.claude_bin ?? "claude",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    timeoutMs: input.timeout_ms ?? 120_000,
  });

  const parsed = parseOutput(raw);
  return writeExtractions(input, parsed);
}

function buildUserPrompt(transcript: string): string {
  // The transcript can be large. We send the whole thing — claude -p will
  // truncate or error if it's beyond its window; we surface that error verbatim
  // rather than guessing at a chunking strategy in v1.
  return [
    "Classify this Claude Code session transcript. Return strict JSON per the system prompt.",
    "",
    "=== TRANSCRIPT (JSON Lines) ===",
    transcript.trim(),
    "=== END TRANSCRIPT ===",
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

function parseOutput(raw: string): ClassifyOutput {
  const trimmed = raw.trim();
  // Some shells / Claude versions wrap JSON in ```json fences — strip them.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `classifier produced non-JSON output (first 300 chars): ${stripped.slice(0, 300)}`,
    );
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("classifier output was not a JSON object");
  }
  const cast = obj as Partial<ClassifyOutput>;
  return {
    task_type: typeof cast.task_type === "string" ? cast.task_type : null,
    outcome: typeof cast.outcome === "string" ? cast.outcome : null,
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

function writeExtractions(input: ClassifyInput, out: ClassifyOutput): ClassifyResult {
  const rejections: ClassifyResult["rejections"] = [];
  let written = 0;

  const allowed = new Set<string>(PROFILE_FIELDS);

  for (const ex of out.extractions) {
    if (!allowed.has(ex.profile_field)) {
      rejections.push({ field: ex.profile_field, reason: "unknown_field" });
      continue;
    }
    const result = appendEvent({
      customer_id: input.customer_id,
      profile_field: ex.profile_field as ProfileField,
      content: ex.content,
      source_type: "claude_session",
      source_ref: `session:${input.session_id}`,
      source_url: null,
      evidence_text: ex.evidence_text,
      confidence: ex.confidence,
      origin_ts: Date.now(),
      provenance: "measured",
    });
    if (result.status === "written") {
      written++;
    } else {
      rejections.push({ field: ex.profile_field, reason: result.reason });
    }
  }

  return {
    session_id: input.session_id,
    customer_id: input.customer_id,
    task_type: out.task_type,
    outcome: out.outcome,
    extractions_written: written,
    extractions_rejected: rejections.length,
    rejections,
  };
}
