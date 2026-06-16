# 02 — Architecture

## Three context layers

Mitable maintains the same three kinds of knowledge a staff FDE accumulates.

| Layer | Source of truth for | Customer-specific? |
|---|---|---|
| 1. Customer Profile | What is true about a specific customer | Yes — one per customer |
| 2. Product Manual | What the product can do and how an FDE operates it | No — shared across customers |
| 3. Playbook | How the company performs repeatable work | No — shared across customers |

Each layer is documented in its own file: [03-customer-profile.md](03-customer-profile.md), [04-product-manual.md](04-product-manual.md), [05-playbook.md](05-playbook.md).

## How context is assembled

When an FDE invokes `/mitable <customer>`, the system:

1. Loads the customer's materialized profile from the event log
2. Selects fields relevant to the FDE's likely work (see [05-playbook.md](05-playbook.md) for the work-mode weights)
3. Pulls relevant playbook entries for that work mode
4. Pulls relevant product-manual pages
5. Renders a single markdown brief and injects it as background knowledge for the session

This is the same brief the FDE would have assembled mentally. The details are in [08-context-assembly.md](08-context-assembly.md).

## How knowledge gets in

Two background paths and one synchronous path feed the layers.

**Background ingestion** populates the Customer Profile:

- **Slack sweep** — configured channels are read on a 5-minute cadence; threads are classified into the eleven profile fields
- **Granola sweep** — meeting notes are read via the Granola MCP on the same cadence and classified the same way

**Hook-based capture** also populates the Customer Profile:

- **`sessionEnd` hook** — when a Claude session ends, the transcript is classified and high-confidence extractions are written to the event log

**Manual authoring** populates the Product Manual and Playbook. These layers are canonical knowledge owned by the team. A stub skill (`/mitable-build-product-manual`) scaffolds the directory structure for them.

All paths converge on the same store: an append-only event log. The materialized profile is a view computed from that log. Details in [09-data-model.md](09-data-model.md).

## The system loop

```
Work happens (FDE + Claude session, customer Slack thread, recorded meeting)
        ↓
Information is discovered (transcript, message, note)
        ↓
Classifier extracts profile-field-tagged signals with quoted evidence
        ↓
Confidence gate + dedup + conflict policy decide what to write
        ↓
Event log updated → materialized profile updated
        ↓
Next /mitable invocation pulls a richer, more current brief
        ↓
Work happens (continue)
```

The system gets more useful with every interaction. Stale knowledge gets superseded; new knowledge gets appended; nothing is ever silently deleted.

## What the agent sees

The agent never reads the event log directly. The agent reads:

1. The brief injected at `/mitable <customer>` time
2. Tools exposed by Mitable's own MCP server (for profile read/write during a session)
3. The codebase, when deeper technical detail is needed

The Product Manual is deliberately the FDE's mental model of the product, not the codebase. When the agent needs implementation detail, it inspects the code. This keeps the Product Manual focused and the codebase authoritative.

## Boundaries

Mitable owns:

- Customer memory (profile event log)
- Product knowledge (manual)
- Operating knowledge (playbook)
- Context assembly into briefs
- The skill, hooks, and command center that expose all of the above

Mitable does not own:

- The customer's source-of-truth systems (CRM, ticketing, etc.)
- The product's architecture documentation (the codebase is authoritative)
- The decisions the FDE makes — only the inputs to those decisions
