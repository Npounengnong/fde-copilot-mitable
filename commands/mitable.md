---
name: mitable
description: Load customer context into the session, or (with no argument) open the Mitable command center.
---

# /mitable

The user has invoked the Mitable command. Decide which skill to delegate to based on what they passed.

## Routing

- **`/mitable <customer>` (any positional argument present)** → invoke the **`mitable-load-context`** skill. Pass the full input through; that skill knows how to parse the customer ID and optional `--mode` flag.

- **`/mitable` (no argument)** → invoke the **`mitable-open-command-center`** skill. That skill calls the `open_command_center` MCP tool, which starts a local Hono server on `http://127.0.0.1:<port>` and returns the URL for the user to open in their browser.

- **`/mitable --help` or anything that looks like a help request** → briefly explain:

  > `/mitable <customer>` — load that customer's profile into this session
  > `/mitable <customer> --mode investigate|implement` — pick the work mode (default: investigate)
  > `/mitable` (no arg) — open the command center web UI

That's it. Don't add other behaviors here; everything else belongs in a dedicated skill.
