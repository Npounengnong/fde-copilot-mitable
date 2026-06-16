# 04 — Product Manual (Layer 2)

The Product Manual is the source of truth for product knowledge: what the product can do and how an FDE uses it. Shared across all customers.

It deliberately excludes architecture, implementation details, and database schemas. When deeper technical knowledge is required, the agent inspects the codebase directly.

## Why this layer is canonical (and not extracted)

Customer Profile entries are extracted from messy signals (Slack, Granola, transcripts). Product knowledge is different: it should be authoritative, versioned, and reviewed. Letting a classifier write directly to the Product Manual would create drift in the foundation that every customer profile depends on.

So the Product Manual is **manually authored**. v1 ships a stub builder skill (`/mitable-build-product-manual`) that scaffolds the directory tree; population is a team activity.

## Structure

```
data/product/
├── README.md
├── building-blocks/
│   ├── configuration-primitives/
│   ├── integrations/
│   └── mcp-tools/
└── pages/
```

## Building Blocks

Canonical definitions of reusable product concepts. Pages reference them; they don't get redefined per page.

### Configuration Primitives

The configurable pieces of the product. Examples: workflow types, trigger types, action types.

Per primitive: name, purpose, configurable parameters, common pitfalls.

### Integrations

Connected external systems. Examples: Salesforce, Zendesk, Slack.

Per integration:

- **Purpose** — what it's for
- **Authentication model** — OAuth / API key / etc.
- **Data flow** — directionality, sync model (push/pull/poll)
- **Common considerations** — known limitations and FDE-relevant gotchas

### MCP Tools

AI-callable capabilities exposed by the product.

Per tool:

- **Purpose** — what it does
- **Inputs** — parameter schema
- **Expected behavior** — what the agent should expect on success and failure
- **Associated product functionality** — which feature it backs

## Pages

The FDE's mental model of the product — the equivalent of a "what would I show a new hire" tour. Each page describes:

- **What the page is for** — the user goal
- **What functionality exists there** — features at that surface
- **Which building blocks appear there** — references to primitives / integrations / tools
- **Which MCP tools support that functionality** — references to the MCP tool catalog
- **Related pages** — links to adjacent pages

Building blocks are referenced from pages, not redefined.

## v1 stub: `/mitable-build-product-manual`

A skill that scaffolds `data/product/` with empty subdirectories and a README placeholder. The skill is intentionally not generative in v1 — it tells the FDE the layer is well-defined and ready to be populated, and (optionally, future) scans the codebase to suggest building-block names.

What the stub does today:

1. Creates `data/product/README.md`, `building-blocks/configuration-primitives/`, `building-blocks/integrations/`, `building-blocks/mcp-tools/`, `pages/` if absent
2. Logs a notice: "Product Manual is canonical and manually authored. Populate this directory with the team."
3. Exits

What the stub does **not** do in v1:

- Read Slack or Granola signals into this layer
- Auto-generate building-block content from the codebase
- Diff product knowledge against running configuration

## Why product knowledge is not customer-scoped

The Product Manual answers "what can the product do?" That answer is the same for every customer. Customer-specific deviations (e.g. "Carver runs Lorikeet on Intercom v48") belong in that customer's **Deployed Configuration** under Layer 1.

If a fact is "this is how the product behaves," it belongs here. If a fact is "this is how this customer has it configured," it belongs in their Customer Profile.

## When Product Manual entries get updated

Manually, when the product changes:

- A new building block ships → add it to `building-blocks/`
- A page UI changes meaningfully → update the corresponding `pages/` entry
- An MCP tool gains/loses a parameter → update the tool's building-block entry

The Playbook ([05-playbook.md](05-playbook.md)) covers when an FDE should consult or update the Product Manual during onboarding, deployments, and reviews.
