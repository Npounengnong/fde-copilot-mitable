# Mitable

A Claude Code plugin that gives AI agents the same customer, product, and operating context as a staff Forward Deployed Engineer.

The idea: an FDE supports many accounts, each with different configs, integrations, stakeholders, commitments, and history. Mitable maintains that context per customer so every Claude session starts informed — no manual recap, no scattered Slack/Granola lookup.

See [docs/](docs/) for the full product spec. Start with [docs/01-overview.md](docs/01-overview.md).

## Install

```
/plugin marketplace add Febchuk/fde-copilot-mitable
/plugin install mitable@mitable
```

Restart Claude Code so it picks up the new MCP server, hooks, and skills.

**Prereqs:** Node 20+, npm, and a C++ toolchain (Xcode CLT on macOS, build-essential on Linux). `start.sh` self-heals the native `better-sqlite3` binding on first run.

## First-run walkthrough

```
/mitable-get-started
```

This loads an example customer (a fictional bakery — see [`examples/acme-bakery/`](examples/acme-bakery/)), renders a brief, and shows you how to add your own customer. Takes about a minute.

## Day-to-day usage

```
/mitable <customer>             # load that customer's profile into the session
/mitable <customer> --mode implement     # default mode is 'investigate'
/mitable                        # open the command center web UI (sources, queue, profiles)
```

After `/mitable <customer>`, Claude has the customer's deployed configuration, active workarounds, stability risks, outstanding commitments, stakeholders, and commercial context as background knowledge. Ask anything customer-specific — answers reference the brief.

## Adding your own customers

Two paths:

**Manual (works today, no setup):**

Call the Mitable MCP tools from any Claude Code session:

```
add_customer({"customer_id": "acme", "display_name": "Acme Inc", "one_liner": "..."})
add_note({"customer_id": "acme", "profile_field": "Stability Risks", "content": "..."})
```

The `add_note` tool writes directly to the event log under `fde_manual` provenance. Useful for capturing things you already know without waiting for ingestion.

**Automatic (Slack + Granola):**

The auto-ingestion path is wired and tested end-to-end (`/mitable` no-arg → Sources → add channel/meeting → 5-min scheduler).

*Granola (Architecture B — Claude fetches via MCP):*
1. Install the Granola MCP in Claude: `claude mcp add granola --transport http https://mcp.granola.ai/mcp`
2. Authorize Claude with Granola (one-time OAuth)
3. When a conversation needs Granola data, Claude calls the Granola MCP to fetch meetings
4. Claude then calls Mitable's `ingest_raw_meeting` tool to store what it found
5. Mitable classifies and writes to the event log automatically

*Slack:* still ships with a stub. See Workstream A in [docs/workstreams-next.md](docs/workstreams-next.md).

## What it looks like

When `/mitable acme-bakery` runs, the brief injected into your session looks like:

```markdown
# Customer Context: Acme Bakery

_Mode: investigate_

## Deployed Configuration
- # Deployed Configuration — Acme Bakery ...

## Active Workarounds
- WA-001: Manual allergy sync via Google Sheet ...

## Stability Risks
- SR-001: Allergy sheet drift — highest severity ...

...
```

Section order is decided by the work mode you pass — INVESTIGATE puts Stability Risks / Deployed Configuration / Active Workarounds first; future modes (Renewal-Prep, Onboarding) will weight differently. See [docs/05-playbook.md](docs/05-playbook.md).

## Verify install

From a Claude Code session, call the Mitable MCP `ping` tool. Expected: `pong — mitable 0.1.1`.

## Architecture

```
.claude-plugin/
  plugin.json                manifest
  marketplace.json           tells Claude Code where the plugin lives
  hooks.json                 SessionEnd → hooks/session-end.mjs
.mcp.json                    registers Mitable MCP via start.sh
start.sh                     bootstrap + exec, self-heals native modules
bin/init.ts                  one-shot setup of ~/.mitable/
commands/                    /mitable, /mitable-get-started
skills/                      load-context, command-center,
                             get-started, build-product-manual
hooks/session-end.mjs        queues sessions for classification
src/
  mcp/server.ts              MCP server: ~22 tools
  store/                     SQLite event log, dedup, channel + meeting maps
  ingest/                    Slack + Granola scan paths, scheduler
    ingest_raw_meeting       MCP tool for Claude to push Granola data
  classify/transcript.ts     session transcript classifier (claude -p)
  assembly/                  work-mode weights + brief renderer
  playbook/, product/        Layer 2 + Layer 3 loaders
  web/                       Hono command-center
docs/                        canonical product spec (11 files)
examples/                    canned customer fixtures
eval/carver/                 17-assertion test suite
```

## Tests

```
npm test
```

Assertions against both the Carver fixture (kept in `refs/`, gitignored — internal worked example) and the public example at `examples/acme-bakery/`.

## License

Apache-2.0
