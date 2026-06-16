#!/usr/bin/env bash
# Bootstrap and run Mitable's MCP server.
# Claude Code invokes this via .mcp.json. Anything written to stdout becomes MCP protocol traffic,
# so all setup logging goes to stderr.

set -euo pipefail

cd "$(dirname "$0")"

log() { echo "[mitable] $*" >&2; }

if [ ! -d node_modules ]; then
  log "installing dependencies (first run)..."
  npm install --no-audit --no-fund --loglevel=error >&2
fi

TSX="./node_modules/.bin/tsx"

log "running init..."
"$TSX" bin/init.ts

log "starting MCP server..."
exec "$TSX" src/mcp/server.ts
