#!/usr/bin/env bash
# Bootstrap and run Mitable's MCP server.
# Claude Code invokes this via .mcp.json. Anything written to stdout becomes MCP protocol traffic,
# so all setup logging goes to stderr.

set -euo pipefail

cd "$(dirname "$0")"

log() { echo "[mitable] $*" >&2; }

# Prereq: Node + npm on PATH.
if ! command -v node >/dev/null 2>&1; then
  log "ERROR: 'node' not on PATH. Install Node.js 20 or newer."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  log "ERROR: 'npm' not on PATH. It usually ships with Node.js."
  exit 1
fi

# Prereq: Node ≥ 20. tsx and our ES2022 + node:test usage assume it.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  log "ERROR: Node $NODE_MAJOR detected. Mitable requires Node 20+."
  exit 1
fi

if [ ! -d node_modules ]; then
  log "installing dependencies (first run)..."
  npm install --no-audit --no-fund --loglevel=error >&2
fi

# better-sqlite3 is a native module. The published prebuilt binary doesn't
# always cover every (Node ABI × OS × arch) combo a user has, and `npm install`
# under some package managers silently skips the source-build fallback. Detect
# the failure once and rebuild — saves every new user from running
# `npm rebuild better-sqlite3` by hand.
verify_sqlite() {
  node -e "require('better-sqlite3')" >/dev/null 2>&1
}

if ! verify_sqlite; then
  log "better-sqlite3 native binding missing — rebuilding (first run on this Node version)..."
  npm rebuild better-sqlite3 --loglevel=error >&2
  if ! verify_sqlite; then
    log "ERROR: better-sqlite3 still fails to load after rebuild."
    log "Make sure you have a C++ toolchain (Xcode CLT on macOS, build-essential on Linux)."
    exit 1
  fi
  log "better-sqlite3 ready"
fi

TSX="./node_modules/.bin/tsx"

log "running init..."
"$TSX" bin/init.ts

log "starting MCP server..."
exec "$TSX" src/mcp/server.ts
