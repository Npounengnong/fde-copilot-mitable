# Mitable

A Claude Code plugin that gives AI agents the same customer, product, and operating context as a staff Forward Deployed Engineer.

See [docs/](docs/) for the full product spec. Start with [docs/01-overview.md](docs/01-overview.md).

## Status

v0.1.0 — skeleton. The MCP server loads and exposes a single `ping` tool. Subsequent milestones add the event log, brief assembly, hooks, ingestion, and the command center.

## Install (local development)

```sh
# clone the repo, then:
cd fde-copilot-mitable
npm install
npm run typecheck
```

The plugin is registered via `.mcp.json` at the repo root. To load it into Claude Code, point Claude Code at this directory as a local plugin source (instructions depend on Claude Code's plugin-management UI / CLI).

On first invocation `start.sh` will:

1. `npm install` if `node_modules/` is missing
2. Run `bin/init.ts` to create `~/.mitable/` (or `$MITABLE_HOME` if set)
3. `exec` the MCP server (`src/mcp/server.ts`)

## Verify the skeleton loaded

From a Claude Code session, call the Mitable MCP `ping` tool. Expected response: `pong — mitable 0.1.0`.

## Layout

```
.claude-plugin/plugin.json    plugin manifest
.mcp.json                     MCP server registration
start.sh                      bootstrap + exec
bin/init.ts                   one-shot setup of ~/.mitable/
src/mcp/server.ts             the long-running MCP server
docs/                         canonical product spec
refs/                         original design references (gitignored)
```

## License

Apache-2.0
