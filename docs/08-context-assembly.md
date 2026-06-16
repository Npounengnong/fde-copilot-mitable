# 08 — Context Assembly

How the three layers combine into the single markdown brief that gets injected when `/mitable <customer>` is invoked.

This is the bridge between the work-mode weights in [05-playbook.md](05-playbook.md) and the brief format in [06-interaction-model.md](06-interaction-model.md) §4.

## Inputs

The assembler takes:

- `customer_id` — required
- `work_mode` — `investigate` | `implement` (defaults to `investigate` if not passed and unable to infer)
- `token_budget` — soft upper bound on brief size; defaults to ~3,000 tokens
- `as_of` — optional point-in-time; defaults to "now"

## Steps

### 1. Materialize the Customer Profile

Query the event log:

```
SELECT * FROM events
WHERE customer_id = :customer_id
  AND valid_until IS NULL
  AND operation != 'remove'
  AND created_at <= :as_of
```

Group results by `profile_field`. This produces eleven buckets, possibly empty.

### 2. Apply work-mode weights

Look up the weight table for the selected work mode from `src/assembly/work-mode.ts` (sourced from [05-playbook.md](05-playbook.md)).

For each profile field with entries, compute:

- **Section weight** — the field's weight in the current mode (1–10)
- **Entries to include** — capped per field; high-weight fields get more entries (rough rule: `min(entries, ceil(weight * 0.6))`)

Sort sections by weight descending. Empty sections are dropped entirely.

### 3. Pull relevant Playbook entries

For each Playbook category with a weight ≥ 5 in the current mode, include either:

- Its README (preferred — shorter, links to specific procedures)
- The single most-relevant procedure file if the README is missing

Playbook content is added as a single `## Relevant Playbook` section near the end of the brief.

### 4. Pull relevant Product Manual pages

v1: no-op. Product Manual is unpopulated. The section is omitted when empty.

Future: when populated, pull pages referenced by the entries in §1 (e.g. if Deployed Configuration mentions "Intercom integration", include the Intercom integration building-block page).

### 5. Render markdown

Output format follows [06-interaction-model.md](06-interaction-model.md) §4:

```
# Customer Context: <customer>

## <Field name, in weight order>
- <content> (<date> · <source_type> · <provenance>)
  Evidence: "<evidence_text>"
- ...

## Relevant Playbook
- <playbook entry summary, with link>
```

Provenance is shown inline so the FDE can judge trust at a glance.

### 6. Token-budget truncation

If the rendered brief exceeds `token_budget`:

1. Drop entries from the lowest-weight section first (lowest-weight section becomes a one-line summary or is removed)
2. Within a section, drop the oldest entries first
3. Never drop the `Recent Changes (last 14 days)` slice of Change Log — it's the strongest signal at the start of a session

Truncation is a soft limit. If the brief is naturally small, it stays small.

## Inference of work mode

If `--mode` is not passed, infer from session signals at invocation time:

1. **Explicit override** — if `--mode` was passed, use it
2. **Hook history** — last 3 sessions for this customer; majority work mode wins
3. **CWD pattern** — heuristics: `/incidents/`, `/triage/` → INVESTIGATE; `/deployments/`, `/workflows/` → IMPLEMENT
4. **Default** — INVESTIGATE

The inferred mode is shown to the FDE in the brief header so they can correct it if wrong. Correction is `/mitable <customer> --mode <other>`.

## What the brief is and is not

The brief **is**:

- A read-only snapshot the agent should treat as current truth
- Annotated with provenance so the agent can judge trust
- Selected and ordered by work mode

The brief is **not**:

- A complete dump of the event log (the agent does not read individual events)
- A decision (the agent and FDE still decide what to do with this context)
- Mutable mid-session (it's a snapshot at invocation time; subsequent updates require a new `/mitable` call)

## Implementation surface

| Module | Responsibility |
|---|---|
| `src/assembly/work-mode.ts` | Field-weight tables, mode inference |
| `src/assembly/brief.ts` | Materialize → weight → render |
| `src/store/event-log.ts` | Materialized-view query |
| `src/playbook/load.ts` | Read Playbook markdown for selected categories |
| `src/product/load.ts` | Read Product Manual entries (no-op in v1) |

The CLI surface for testing the assembler outside of a session:

```
mitable brief carver --mode investigate
```

This is the primary smoke test during development.
