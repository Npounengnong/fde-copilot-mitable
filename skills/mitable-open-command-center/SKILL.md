---
name: mitable-open-command-center
description: Open the Mitable command center — a local web UI for viewing customer profiles, managing Slack channel + Granola meeting mappings, and inspecting the classification queue. Use when the user runs /mitable with no argument, or asks to "open mitable", "show the command center", "let me see the profile UI", or similar.
---

# Mitable — Open Command Center

You start a local web server and give the user a URL to open in their browser.

## When to invoke

- The user typed `/mitable` with no positional argument
- The user asked to open the command center, the Mitable UI, the profile viewer, the sources config, the queue, etc.

If the user typed `/mitable <customer>` (a positional arg present), this is NOT the right skill — that loads context. Hand off to `mitable-load-context`.

## What to do

1. **Call the `open_command_center` MCP tool** (no arguments needed). The tool is on the Mitable MCP server, typically registered as `mcp__mitable__open_command_center`. It returns JSON like `{"url": "http://127.0.0.1:54321", "already_running": false}`.

2. **Tell the user the URL in one short line.** Format:
   - First time: `Command center: http://127.0.0.1:<port> — open it in your browser.`
   - Already running: `Command center already running at http://127.0.0.1:<port>.`

3. **That's it.** Don't try to fetch the page, don't summarize what's on it, don't re-explain how the command center works. The user is about to look at it.

## What the user will see

(Don't proactively recite this. Only mention specific pages if the user asks where to go.)

- `/` — overview: status header (last sweep times, queue counts), customer list
- `/customers/<id>` — full profile view for one customer (all eleven fields, provenance tags, evidence snippets)
- `/sources` — Slack channels + Granola meetings, with add/pause/remove forms
- `/queue` — classification queue: pending sessions waiting for `drain_classifications`

## What NOT to do

- Don't open the URL on the user's behalf via `open` or `xdg-open` unless the user explicitly asked you to. Just give them the link.
- Don't repeatedly call `open_command_center` in the same session. It's idempotent — second call returns the same URL — but spamming it is noise.
- Don't try to scrape the UI content into the chat. The point of the UI is that the user looks at it directly.
- Don't worry about killing the server. It exits when the MCP server exits (when Claude Code closes).
