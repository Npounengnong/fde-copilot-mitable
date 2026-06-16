# 07 — Scan and Store

How the system builds the Customer Profile automatically. No FDE action required after initial setup.

## Overview

Three inputs feed the profile:

1. **Claude sessions** — classified on `sessionEnd` via hook
2. **Slack** — swept on a schedule, scoped to configured channels
3. **Granola** — swept on a schedule, scoped to meetings mapped to customers

All paths converge on the same store: the event log defined in [09-data-model.md](09-data-model.md). Same dedup logic, same confidence gate, same per-field conflict policy.

---

# Part 1 — Scan

## 1.1 Input: source-to-customer maps

The only source of scope for background ingestion. Configured once in the command center.

```
slack:    { customer_id, channel_id, channel_name, active, watermark_ts }
granola:  { customer_id, meeting_id_or_calendar_event_id, active, watermark_ts }
```

No dynamic discovery. The system reads exactly the channels/meetings the FDE registered.

## 1.2 Two-phase execution (Slack)

Slack enforces separate rate-limit buckets for search (Tier 2) and channel history / thread replies (Tier 3). Mixing them in one pass causes 429s. Two phases keeps each bucket clean.

**Phase A — Availability probe**

For each active channel:

```
slack_read_channel(channel_id, oldest=watermark_ts, limit=1)
```

- Zero results → skip entirely, advance nothing
- One+ results → mark channel for Phase B

**Phase B — Full read**

For each channel that passed Phase A:

```
slack_read_channel(channel_id, oldest=watermark_ts, limit=200)
```

Then for threads worth deep-reading (reply count > 3, or FDE participated):

```
slack_read_thread(channel_id, thread_ts, oldest=thread_watermark_ts)
```

Per-thread watermarks are tracked separately — re-reads only pick up new replies.

> **Implementation note:** the exact MCP tool names depend on which Slack MCP server is installed. The adapter in `src/ingest/slack.ts` isolates real tool names to one file so the rest of the codebase remains stable.

## 1.3 Two-phase execution (Granola)

Granola is connected via `claude mcp add granola --transport http https://mcp.granola.ai/mcp`. The ingestion contract mirrors Slack:

**Phase A — Probe**

Per active meeting mapping, request a cheap "has new content since watermark" check.

**Phase B — Full read**

For each meeting that passed Phase A, fetch the full note body via the Granola MCP and pass it to the classifier.

Per-meeting watermarks advance independently.

## 1.4 Watermarks

Each channel, thread, and meeting stores a `watermark_ts` equal to the newest timestamp seen on the last successful read.

**Advance-only rule:** watermarks never move backward. Reruns are idempotent — a source scanned twice in the same window produces no duplicates because the second pass sees no new content.

**First run:** default lookback = 7 days. FDE channels are high-volume; longer windows produce too much noise on initial setup.

## 1.5 Auth preflight

Before reading anything, probe the source with a cheap call:

- Slack: `slack_search_public_and_private(query="in:#channel-name", count=1)`
- Granola: a low-cost `list_meetings` call

If auth is expired or the only exposed tool is `authenticate`:

- Skip that source for this run
- Surface a one-line fix in the command center header: `Slack auth expired — run /mcp → plugin:slack → authenticate`
- Continue with other sources (session classification is unaffected)

Never fail silently. The FDE should always know why a sweep didn't run.

## 1.6 Rate-limit recovery

On 429:

1. Respect the `Retry-After` header
2. Retry once
3. If still 429: skip that channel/meeting, log the error, continue

Log entry: `{ source, ref, code: "RATE_LIMIT", ts }`

Surfaced in command center status: `"Channel #carver-support skipped — rate limited (Jun 15)."`

Do not auto-retry in the background. The next scheduled sweep picks up where this one left off.

## 1.7 Signal classification

Every signal maps to exactly one Customer Profile field. One thread or meeting can produce signals for multiple fields — each is extracted independently.

| Signal | Profile Field |
|---|---|
| Commitment / action item / deadline | Outstanding Commitments |
| Technical decision or trade-off | Decision Rationale |
| Workaround / patch / temporary fix | Active Workarounds |
| Fragile system / failure condition | Stability Risks |
| Deployment or configuration change | Change Log |
| Product limitation / can't do X | Capability Gaps |
| Metric / rate / number | Outcome Metrics |
| Stakeholder / org info / role change | Stakeholder Map |
| Communication style or sensitive topic | Communication Context |
| Renewal / contract / expansion signal | Commercial Context |

Classification uses an LLM pass over each thread or meeting. The classifier must quote the source passage that supports each extraction (`evidence_text`). If no passage can be quoted, the extraction is invalid and discarded — this is the primary hallucination guard.

## 1.8 Extraction shape

```
{
  customer_id,
  profile_field,
  content,        // distilled, self-contained assertion
  operation,      // "add" | "remove" | "update"
  source_type,    // "slack" | "granola" | "claude_session"
  source_ref,     // permalink-equivalent ID (e.g., "C0123456:1718123456.000100")
  source_url,     // human-clickable link back to the source
  evidence_text,  // verbatim quoted passage — required
  confidence,     // 0.0–1.0
  origin_ts,      // when the underlying signal happened
  provenance      // see [03-customer-profile.md]
}
```

---

# Part 2 — Store

## 2.1 Event log as foundation

Every write to the profile is an immutable event. The materialized profile is a view computed from the event log. Schema in [09-data-model.md](09-data-model.md).

The materialized profile = all events where `valid_until IS NULL AND operation != 'remove'`.

**Point-in-time query:** filter `created_at <= target_ts`. This is how renewal comparisons work ("what did the profile say 60 days ago?").

**No deletes. Ever.** Corrections are new events with `operation: "supersede"`.

## 2.2 Two-stage dedup

Runs at write time before any event is committed.

**Stage 1 — Exact match**

Normalize the content (lowercase, collapse whitespace), hash it. Reject if the same hash already exists for the same `customer_id + profile_field`.

**Stage 2 — Semantic match**

BM25 retrieval of top-3 existing entries for the same customer + field, then cosine similarity:

| Cosine | Length Ratio | Action |
|---|---|---|
| ≥ 0.85 | ≤ 1.3× | Reject as duplicate. Update `last_confirmed_at` on existing entry. |
| ≥ 0.85 | > 2.0× | Supersede: mark old entry `valid_until = now`, write new entry with `superseded_by = old_id`. |
| 0.60–0.84 | any | Check entity overlap. If ≥ 50% shared entities → reject. Else write. |
| < 0.60 | any | Write unconditionally. |

**Source priority when superseding:**

Claude session > Granola > Slack

A Slack signal cannot supersede a Claude session extract. It can only supersede another Slack signal or a Granola signal.

## 2.3 Confidence gate

Low-confidence extractions (< 0.7): discarded silently. No queue, no FDE action.

High-confidence (≥ 0.7): written directly to the event log. Visible in the profile immediately.

The threshold is conservative on purpose. Missing signal occasionally is acceptable; polluting the profile with low-quality data is not. The threshold is tuned down only after the classifier's false-positive rate is measured.

## 2.4 Per-field conflict policy

The full table is in [03-customer-profile.md](03-customer-profile.md) §"Per-field policy on contradictions". Repeated here for reference:

| Field | On contradiction |
|---|---|
| Deployed Configuration | Supersede. Keep history. |
| Active Workarounds | Supersede if new entry signals "removed" / "fixed" at ≥ 0.85 cosine. Otherwise append. |
| Change Log | Append-only. |
| Decision Rationale | Append. Link prior entry as "reconsidered". |
| Stability Risks | Supersede if new entry signals resolution. |
| Capability Gaps | Supersede if new entry signals fix. Otherwise append. |
| Outcome Metrics | Time series. Always append. |
| Outstanding Commitments | State machine. Auto-transition open → fulfilled. |
| Stakeholder Map | Append. Supersede only on explicit role change. |
| Communication Context | Supersede. Latest wins. |
| Commercial Context | Supersede. Full history retained. |

## 2.5 Async merge queue

After each batch write completes, a non-blocking background pass checks for high-cosine pairs across the full profile:

- Pairs with cosine > 0.85 queued in `pending_merges` with canonical ordering (`id_a < id_b`)
- Queue processed on the next maintenance cycle
- Resolution follows §2.4 — automatic, no FDE action

The write path completes before this check runs. Storing a new entry is never blocked by merge detection.

---

## What this does not cover

- **Multi-FDE sync** — deferred to a future version (see [10-non-goals.md](10-non-goals.md))
- **Embedding model choice** — implementation detail; left to `src/store/dedup.ts`
- **Session classification details** — handled by the `sessionEnd` hook; same store path
