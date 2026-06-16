---
name: mitable-build-product-manual
description: Scaffold the Mitable Product Manual directory tree at $MITABLE_HOME/product/ so the team can start authoring canonical product knowledge (building blocks, pages). Use when the user asks to "set up the product manual", "scaffold product knowledge", "create the product directory", or runs the build-product-manual command.
---

# Mitable — Build Product Manual (Stub)

You scaffold the directory tree where the team will author canonical
product knowledge. **You do not generate the content.** The Product
Manual is deliberately manually authored — see docs/04-product-manual.md.

## When to invoke

- The user asks to scaffold / set up / create / build the product manual
- The user is following the docs and wants to start populating Layer 2
- A teammate runs this as part of plugin first-run setup

## What to do

1. **Call the `scaffold_product_manual` MCP tool** with no arguments. Typically registered as `mcp__mitable__scaffold_product_manual`. It creates:
   - `$MITABLE_HOME/product/README.md` — explainer the team will read
   - `building-blocks/configuration-primitives/`
   - `building-blocks/integrations/`
   - `building-blocks/mcp-tools/`
   - `pages/`

   The tool is idempotent — calling it on an already-scaffolded directory does nothing destructive.

2. **Report back honestly in 2–3 lines.** Format roughly:
   - First time: `Product Manual scaffolded at <path>. Created <N> dirs + README. Populate building-blocks/ and pages/ with the team — Mitable never writes here.`
   - Already scaffolded: `Product Manual already exists at <path>. Nothing to do.`

3. **That's it. Do not auto-generate content.** Per docs/10-non-goals.md, automated population of the Product Manual is explicitly out of scope. If the user pushes for content generation, say:
   > Generating canonical product knowledge would create drift in the foundation that every Customer Profile depends on. We keep this layer manually authored on purpose. Happy to help draft a single page if you point me at the product, but I won't bulk-generate them.

## What NOT to do

- Don't scan the codebase to "auto-fill" the building blocks. That's a v2 idea, not v1.
- Don't write to `$MITABLE_HOME/product/` directly via Write/Edit. Use the MCP tool — it owns the layout contract.
- Don't repeatedly call `scaffold_product_manual`. It's idempotent but calling it more than once per session is noise.
