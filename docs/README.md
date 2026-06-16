# Mitable — Product Documentation

Mitable is a Claude Code plugin that gives an AI agent the same situational awareness as a staff Forward Deployed Engineer (FDE): customer history, product knowledge, and the company's way of working.

This directory is the canonical product spec. The source material in `../refs/` informed it; from here forward, `docs/` is the contract the implementation is held to.

## Reading order

1. [01-overview.md](01-overview.md) — what Mitable is and why it exists
2. [02-architecture.md](02-architecture.md) — the three context layers and the system loop
3. [03-customer-profile.md](03-customer-profile.md) — Layer 1: the eleven profile fields
4. [04-product-manual.md](04-product-manual.md) — Layer 2: building blocks and pages
5. [05-playbook.md](05-playbook.md) — Layer 3: operating knowledge + work-mode field weights
6. [06-interaction-model.md](06-interaction-model.md) — how an FDE actually uses Mitable: skills, hooks, command center
7. [07-scan-and-store.md](07-scan-and-store.md) — how Slack and Granola feed the profile
8. [08-context-assembly.md](08-context-assembly.md) — how the three layers combine into a brief
9. [09-data-model.md](09-data-model.md) — event log, materialized view, watermarks, schemas
10. [10-non-goals.md](10-non-goals.md) — what we are deliberately not building in v1

A worked example using a fictional customer (Carver) lives at [examples/carver/](examples/carver/).

## Status

v1 design complete. Implementation in progress.
