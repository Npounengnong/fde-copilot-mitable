# 01 — Overview

## What Mitable is

A Claude Code plugin that maintains organizational memory for a Forward Deployed Engineer (FDE) team and automatically packages the right context whenever an FDE works with an AI agent.

When an FDE invokes `/mitable <customer>`, Claude is briefed on the customer before the conversation begins: deployed configuration, active workarounds, stability risks, outstanding commitments, recent changes, stakeholders, and commercial context. No manual context-gathering.

## The problem

A single FDE may support dozens of accounts. Each account has its own configuration, integrations, stakeholders, commitments, risks, and history. Before the FDE can effectively use AI on behalf of a customer, they have to rebuild a mental model of that account from Slack threads, meeting notes, product docs, prior sessions, and memory.

The cost of context switching scales with the number of customers. The information needed to apply FDE expertise is fragmented across systems and people, with three consequences:

- AI interactions start with incomplete context
- FDEs repeatedly re-explain customer history
- Customer knowledge concentrates in individual team members

The problem isn't a lack of expertise. It's the overhead of reconstructing the context that expertise depends on.

## What Mitable does about it

Maintains a continuously updated understanding of every customer, every product capability, and every operating procedure — and injects the relevant slice into the AI session at the moment work begins.

The FDE's day-to-day flow doesn't change. They invoke one skill at session start. Everything else — Slack sweeps, meeting-note ingestion, profile updates, session classification — happens in the background.

## Who Mitable is for

- **Primary user:** an FDE who supports multiple customer accounts and uses Claude Code daily
- **Secondary user:** the FDE team, which benefits when customer knowledge stops being concentrated in individuals

Mitable is not for end customers, not for support agents at customer companies, and not for engineers working on a single product without an FDE function.

## What Mitable is not

Mitable does not replace FDE judgment. FDEs remain responsible for prioritization, trade-offs, customer strategy, relationship management, escalation decisions, and final execution.

Mitable is responsible for: maintaining customer memory, maintaining organizational memory, retrieving relevant context, and packaging information for AI agents.

The objective is not to decide for the FDE. The objective is to ensure the FDE never starts from a blank slate.

## The staff-FDE model

A staff FDE is valuable because they accumulate three kinds of context over time:

- **The customer** — what has happened, why, and what matters
- **The product** — what it can do, how it is configured, how it is typically used
- **The company** — how work is performed, how customers are onboarded, how deployments are executed

Mitable captures and maintains all three. The next document, [02-architecture.md](02-architecture.md), describes how.
