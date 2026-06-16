/**
 * Slack-thread classifier.
 *
 * Spec: docs/07-scan-and-store.md §1.6 (classification), §1.7 (extraction shape),
 * §1.8 (writes go through the same gate as everything else).
 *
 * Same pattern as src/classify/transcript.ts:
 *   - Spawn `claude -p` with a strict-JSON system prompt
 *   - Require verbatim evidence_text per extraction (the primary hallucination guard)
 *   - Hand the parsed rows to appendEvent — confidence gate + dedup happen there
 *
 * Differences from the transcript classifier:
 *   - source_type = "slack"
 *   - source_ref = "<channel_id>:<thread_ts>"
 *   - source_url = the permalink, if provided
 *   - origin_ts = parent message ts × 1000 (Slack ts is seconds with microsecond fraction)
 *   - provenance = "customer_reported" by default (Slack messages typically come from the
 *     customer or the FDE — finer attribution is a later refinement)
 */
import { spawn } from "node:child_process";
import { appendEvent } from "../store/event-log.js";
import { PROFILE_FIELDS, type ProfileField } from "../store/schema.js";
import type { SlackThread } from "./slack-adapter.js";

export interface ThreadClassifyInput {
  customer_id: string;
  thread: SlackThread;
  claude_bin?: string;
  timeout_ms?: number;
}

export interface ThreadClassifyResult {
  channel_id: string;
  thread_ts: string;
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
You extract customer-profile updates from a Slack thread.

You will receive a Slack thread as JSON (channel_id, thread_ts, an array of messages
oldest first). For each message, you see who said it (user) and what they said (text).

Map signals in the thread to the eleven profile fields below. ONE thread can produce
multiple extractions (each from a different message or claim). Each extraction goes to
exactly ONE field — pick the strongest match.

Field-to-signal table (use this to decide which field an extraction belongs in):

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

RULES (these are not optional):

1. For EVERY extraction you MUST quote the verbatim text passage that supports it in
   "evidence_text". No paraphrasing. If you can't quote, do not extract.

2. Confidence is 0.0-1.0. The write threshold is 0.7 — anything below is dropped, which
   is correct behavior. Be ruthless: if you're 60% sure, mark 0.6 and let it drop.

3. Acknowledgements ("ok", "sounds good", "thanks") are NOT extractions. Discussion that
   does not commit to anything is NOT an extraction.

4. Distill content to a single self-contained sentence. The downstream agent will read
   it without the surrounding thread.

OUTPUT — strict JSON, no markdown fences, no commentary:

{
  "extractions": [
    {
      "profile_field": "<one of the eleven exact strings>",
      "content": "<one-sentence assertion>",
      "evidence_text": "<verbatim quote from a message>",
      "confidence": 0.85
    }
  ]
}

If nothing in the thread is worth extracting, return {"extractions": []}.
`.trim();

export async function classifyThread(input: ThreadClassifyInput): Promise<ThreadClassifyResult> {
  const userPrompt = buildUserPrompt(input.thread);
  const raw = await runClaudeP({
    bin: input.claude_bin ?? "claude",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    timeoutMs: input.timeout_ms ?? 120_000,
  });
  const parsed = parseOutput(raw);
  return writeExtractions(input, parsed);
}

function buildUserPrompt(thread: SlackThread): string {
  return [
    "Classify this Slack thread. Return strict JSON per the system prompt.",
    "",
    "=== THREAD ===",
    JSON.stringify(
      {
        channel_id: thread.channel_id,
        thread_ts: thread.thread_ts,
        messages: thread.messages.map((m) => ({ ts: m.ts, user: m.user, text: m.text })),
      },
      null,
      2,
    ),
    "=== END THREAD ===",
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

function writeExtractions(
  input: ThreadClassifyInput,
  out: ParsedOutput,
): ThreadClassifyResult {
  const rejections: ThreadClassifyResult["rejections"] = [];
  let written = 0;

  const allowed = new Set<string>(PROFILE_FIELDS);
  const parentTs = input.thread.messages[0]?.ts ?? input.thread.thread_ts;
  const originMs = Math.round(parseFloat(parentTs) * 1000);
  const sourceRef = `${input.thread.channel_id}:${input.thread.thread_ts}`;
  const sourceUrl = input.thread.messages[0]?.permalink ?? null;

  for (const ex of out.extractions) {
    if (!allowed.has(ex.profile_field)) {
      rejections.push({ field: ex.profile_field, reason: "unknown_field" });
      continue;
    }
    const result = appendEvent({
      customer_id: input.customer_id,
      profile_field: ex.profile_field as ProfileField,
      content: ex.content,
      source_type: "slack",
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
    channel_id: input.thread.channel_id,
    thread_ts: input.thread.thread_ts,
    customer_id: input.customer_id,
    extractions_written: written,
    extractions_rejected: rejections.length,
    rejections,
  };
}
