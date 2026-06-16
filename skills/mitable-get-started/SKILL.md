---
name: mitable-get-started
description: First-run walkthrough for the Mitable plugin. Use when the user runs /mitable-get-started, asks "how do I use mitable", "what's the demo", "how do I set this up", or has just installed the plugin and looks unsure what to do next.
---

# Mitable — Get Started

You walk the user through their first 60 seconds with Mitable. Adapt to whether they're starting completely fresh, just want to see the example, or are ready to add their own first customer.

## Decide which path

First, call `list_customers` (the Mitable MCP tool) to see what's already in their store.

- **Zero customers** → fresh install. Run the **Example path** below.
- **At least one customer** → they've used it before. Skip the example, jump to **What next** at the bottom.

Don't ask the user which path; just check and proceed.

## Example path (fresh install)

Tell the user, in this order, in 4 short messages max:

**1. One-line orientation.**
> Mitable maintains customer context so the AI always starts informed. Three layers: per-customer profile, product knowledge, your team's playbook. Let me load an example customer so you can see what a brief looks like.

**2. Seed the example.** Call:
```
seed_fixture({"path": "examples/acme-bakery"})
```
Expect `{"customer_id": "acme-bakery", "written": 11, "skipped": [...]}`. If you get an error about the path, the user installed via marketplace and the working directory isn't the repo — pass an absolute path like `<CLAUDE_PLUGIN_ROOT>/examples/acme-bakery`, or tell them to use `add_customer` + `add_note` instead.

**3. Render the brief.** Call:
```
brief({"customer": "acme-bakery", "mode": "investigate"})
```
Don't paste the brief back at the user — it'll already be visible. Instead, point at one specific thing in it that demonstrates the system, e.g.:
> Loaded acme-bakery. Notice the brief surfaces SR-001 (allergy sheet drift) first — that's because Stability Risks has weight 10 in INVESTIGATE mode per the Work Mode Context Blueprints. The brief ordering is decided by the mode you pass.

**4. Tell them how to add their own.** End with two concrete commands:
> Two ways to add a real customer:
>   • Manual: call `add_customer({"customer_id": "your-customer"})` then `add_note(...)` to drop in things you know
>   • Automatic: configure Slack channels or Granola meetings in the command center (`/mitable` with no argument) and Mitable will populate the profile from those signals
>
> When you're ready, run `/mitable your-customer` to see their brief.

## What next (returning user)

Don't re-show the example. Just give them the menu:

> Welcome back. You have N customers loaded. Try:
>   • `/mitable <customer>` — load context for a customer
>   • `/mitable` (no arg) — open the command center to manage sources
>   • `add_note` MCP tool — drop in a quick observation you don't want to lose

## Caveats — be honest about gaps

If the user asks about Slack/Granola ingestion, tell them honestly:

> The Slack and Granola scan paths are wired and tested, but v0.1 ships with stub adapters that return "no new messages." A real adapter that proxies to the installed Slack/Granola MCPs needs to be hooked up. For now, `add_note` is the realistic way to populate a profile manually.

Don't oversell. The system is real but ingestion is BYO right now.

## What NOT to do

- Don't recite all the MCP tools. Three suggestions is enough.
- Don't paste the full brief markdown back at the user. They can already see it.
- Don't run `seed_fixture` if they already have customers.
- Don't try to set up Slack or Granola integrations on their behalf in this skill — that's its own conversation.
