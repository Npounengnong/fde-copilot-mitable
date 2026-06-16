# 06 — Interaction Model

Everything runs inside Claude Code. No external app, no separate login.

The FDE's day-to-day flow is unchanged. They invoke a skill at session start to get customer context. Everything else — profile building, Slack sweeps, Granola ingestion, classification — happens automatically in the background.

## Surfaces

| Surface | What it is |
|---|---|
| Skill | FDE-invoked — loads customer profile into session context |
| Hooks | Automatic — classify session on end, sweep sources on schedule |
| Command center | Web viewer (`/mitable` with no arg) — profile visibility + one-time configuration |

## 1. The skills

### `/mitable <customer>`

The only thing the FDE does differently. Invoked at session start when they're about to work on a customer.

```
/mitable carver
```

What happens:

1. Read the customer's current materialized profile from the local store
2. Infer or accept the work mode (`--mode investigate` / `--mode implement`)
3. Select fields relevant to the mode using the weights in [05-playbook.md](05-playbook.md)
4. Pull relevant Playbook entries for that mode
5. Pull relevant Product Manual pages (no-op in v1)
6. Render a brief in the format below and inject it as background knowledge

Claude is now aware of the customer's deployed configuration, active workarounds, stability risks, outstanding commitments, stakeholder map, and commercial context. The FDE works normally from here.

### `/mitable` (no argument)

Opens the command center in a local browser. See §3.

### `/mitable-build-product-manual` (v1 stub)

Scaffolds `data/product/` with the directory structure from [04-product-manual.md](04-product-manual.md). Does not populate content — that is a manual team activity in v1.

## 2. Hooks (automatic)

### `sessionEnd` / `AgentIdle`

Fires when a session ends or goes idle. Runs in the background — the FDE sees nothing.

Steps (async, non-blocking):

1. **Noise filter** — fewer than 4 turns or under 2 minutes → skip entirely
2. **Determine customer** — skill invocation is definitive; else CWD pattern, then transcript frequency
3. **Classify task type** (Debugging / Configuration / Scoping / etc.) and outcome (Resolved / In Progress / Blocked)
4. **Extract profile updates** — each extraction requires a quoted `evidence_text` passage from the transcript
5. **Confidence gate** — extractions below 0.7 confidence are discarded silently
6. **Write** — high-confidence extractions write directly to the event log; no holds, no FDE review

### `sessionStart`

No action in v1. Reserved for a future "continuing prior In Progress session" hint.

## 3. Command center

Opened via `/mitable` with no arguments. Local web UI at `localhost:PORT`.

Two purposes: see what the system has learned, and configure data sources. Not a review or approval surface.

### Profile view

Per-customer. All eleven profile fields with their current entries.

Each entry shows: content, source, date, provenance tag (`measured` / `customer_reported` / `fde_reported` / `inferred`).

Read-only. This is an observability surface — FDEs verify the system is capturing the right things, but there are no daily-flow actions here.

### Source configuration

#### Slack channels

Maps Slack channels to customers. The system reads exactly these channels — no others.

```
Carver
  #carver-support              ✓ active    last sweep: Jun 15, 9:14am
  #carver-shared-channel       ✓ active    last sweep: Jun 15, 9:14am
  #fde-carver-internal         ✓ active    last sweep: Jun 15, 9:14am

Acme
  #acme-support                ✓ active    last sweep: Jun 14, 8:02am
  #acme-onboarding             ✓ paused
```

Actions:

- **Add channel** — type channel name, assign to customer
- **Pause** — stops sweep without removing the mapping
- **Remove** — removes from sweep config; past extracted entries are retained

One channel maps to one customer only.

#### Granola

Granola is connected via its MCP server (`https://mcp.granola.ai/mcp`). Meetings are assigned to customers using:

1. Explicit calendar-event ↔ customer mapping when present
2. Otherwise, attendee-domain heuristics
3. Otherwise, surfaced for the FDE to map in the command center

### Status header (persistent)

```
Last session classified: Carver · Debugging · In Progress · 4 min ago
Last Slack sweep:    Jun 15, 9:14am
Last Granola sweep:  Jun 15, 9:14am
Slack auth:    ✓  |  Granola auth:  ✓
```

If auth expires, this surface shows the one-line fix. That is the only action the FDE needs outside initial setup.

## 4. Context brief format

What gets injected when `/mitable carver` is invoked. Fields are selected and ordered by work mode (see [05-playbook.md](05-playbook.md)). Empty fields are omitted entirely.

Example — INVESTIGATE mode, recent work has been debugging:

```
# Customer Context: Carver

## Active Workarounds
- Zapier polling bridge for document status (May 28 · slack · measured)
  Evidence: "Zapier polls Salesforce every 15 minutes and writes doc_status to Intercom"

## Stability Risks
- Zapier doc status lag — 15-min polling delay (May 22 · slack · measured)

## Deployed Configuration
- Lorikeet on Intercom, EN-AU, sentiment threshold 0.3, confidence 0.65

## Recent Changes (last 14 days)
- KB sync refresh + new article tagging — May 20
- Sentiment threshold lowered 0.5 → 0.3 — Apr 15

## Outstanding Commitments
- Fix enterprise routing for Apex Plumbing (ID 84729) — owner: Dylan, urgent
- Recalibrate confidence threshold against 47-article KB — owner: Dylan, due Jun 15

## Stakeholder Map
- Marcus Chen (Head of Customer Support) — primary champion, data-driven
- Priya Shankar (PM, Support Tools) — controls Carver-side engineering capacity

## Communication Context
- Lead with data. Don't oversell. 3-line max in Slack. Sensitive topic: early repayment calculator.
```

Provenance tags appear inline. The FDE sees at a glance whether a fact came from a session they ran or from something a customer said in Slack.

## 5. Scan and store

How the profile is built end-to-end — Slack ingestion, Granola ingestion, classification, dedup, conflict resolution — is in [07-scan-and-store.md](07-scan-and-store.md).
