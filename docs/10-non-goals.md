# 10 — Non-Goals

What Mitable deliberately does not do in v1. Each item here is a conscious deferral, not a missing feature.

## No FDE review queue for extractions

Background extractions write directly to the event log when they clear the confidence gate (≥ 0.7). There is no "pending" or "awaiting review" state.

**Why:** A review queue moves the cost of context-switching from the conversation back to the FDE. The confidence gate is conservative on purpose — missing signal occasionally is acceptable; polluting the profile with low-quality data is not. If the false-positive rate proves too high, the response is to tune the threshold, not to add a review surface.

## No decision automation

Mitable assembles context. It does not pick what to do with it.

**Why:** FDEs remain responsible for prioritization, trade-offs, customer strategy, relationship management, escalation decisions, and final execution. The product philosophy in [01-overview.md](01-overview.md) is explicit: humans decide what matters.

## No multi-FDE sync

The event log lives at `~/.mitable/events.sqlite` on one machine. Two FDEs on the same account will diverge.

**Why:** Sync introduces conflict resolution across machines, a server-side identity model, and shared-storage choices that materially expand scope. v1 is single-FDE. v2 will revisit when the single-FDE experience is proven.

**Mitigation:** the event log is portable. `cp -R ~/.mitable` to a teammate's machine gives them the same view. Manual but feasible for handoffs.

## No automated Product Manual population

The Product Manual is canonical and manually authored. `/mitable-build-product-manual` only scaffolds the directory tree; it does not generate content.

**Why:** Letting a classifier write to the Product Manual creates drift in the foundation every Customer Profile depends on. Authoritative product knowledge is worth the cost of being deliberate about it.

**Future:** the same skill can grow into a codebase-scanning generator that proposes building blocks; until then, it's a scaffold.

## No automated Playbook population

Same logic as Product Manual. The Playbook is operating knowledge owned by the team. It evolves through deliberate practice, not extraction.

**Why:** Operating procedures need ownership and review. The Customer Profile can tolerate machine-extracted noise (it's per-customer, easily superseded). The Playbook is shared and load-bearing.

## No background scheduler outside Claude Code

Mitable's 5-minute sweep loop runs inside the `serve` process spawned by the plugin. When Claude Code isn't running, sweeps don't run.

**Why:** Claude Code plugins don't have a native cron primitive. Spawning a launchd / systemd job behind the user's back is out of scope and surprising.

**Workaround for users who want continuous sweeping:** they can run `mitable serve` in a background terminal. Documented in the plugin README; not the default.

## No real-time UI updates

The command center renders the materialized profile on page load. It does not push live updates as new events arrive.

**Why:** The command center is an observability surface, not a control panel. WebSockets / SSE add complexity without changing what the FDE can do.

**Mitigation:** browser refresh is one keystroke.

## No mobile / hosted web UI

The command center runs only on `localhost`. There is no hosted version.

**Why:** Mitable's data is sensitive (customer commitments, commercial context, internal Slack). Hosting it requires an authentication model, secure storage, multi-tenancy, and a deployment story — none of which are required for the v1 value prop.

## No support for sources other than Slack and Granola

v1 ingests from Slack, Granola, and Claude sessions. Not from email, not from Jira, not from Notion, not from Linear.

**Why:** Each new source is a classifier-tuning project and an auth-flow project. Two background sources plus session capture is enough to validate the core loop. Other sources land based on demand once v1 is in production.

## No cross-customer queries

The brief is per-customer. There is no "show me commitments across all customers due this week" query path in v1.

**Why:** Cross-customer aggregation is a different product surface (a dashboard) with different access-pattern requirements. The data model supports it (`SELECT * FROM events WHERE profile_field='Outstanding Commitments'`), but no UI exposes it.

**Future:** a "weekly digest" surface is a natural v2 candidate.

## No retroactive backfill from external systems

When a new customer is mapped, Mitable sweeps the configured channels from the watermark forward (default 7-day lookback). It does not crawl every historical Slack thread or every past meeting.

**Why:** Historical backfill is expensive against Slack rate limits and produces a lot of noise from stale conversations. The 7-day lookback is enough to bootstrap a useful profile; the rest accumulates organically through normal use.

**Workaround:** an FDE can manually paste key historical decisions via a future `/mitable note` command (not in v1).
