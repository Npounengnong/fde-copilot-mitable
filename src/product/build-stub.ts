/**
 * Product Manual stub builder.
 *
 * Spec: docs/04-product-manual.md, docs/10-non-goals.md.
 *
 * v1 only scaffolds the directory tree and writes a README placeholder.
 * No content generation — the Product Manual is intentionally manually
 * authored (per docs/04 "Why this layer is canonical (and not extracted)").
 *
 * A future version of this can scan the codebase to propose building-block
 * names. Out of scope for v1.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mitableHome } from "../store/schema.js";

export interface ScaffoldResult {
  product_root: string;
  created: string[];
  already_present: string[];
  message: string;
}

const README_BODY = `# Product Manual

This directory is the canonical product knowledge for Mitable, per
docs/04-product-manual.md in the plugin repo.

It is **manually authored** — the classifier never writes here. Letting
an extractor write to this layer would create drift in the foundation
every Customer Profile depends on.

Populate this directory with the team as the product evolves.

## Structure

\`\`\`
product/
├── README.md                    you are here
├── building-blocks/
│   ├── configuration-primitives/    workflow types, trigger types, etc.
│   ├── integrations/                Salesforce, Zendesk, Slack, etc.
│   └── mcp-tools/                   AI-callable capabilities
└── pages/                       FDE's mental model of the product UI
\`\`\`

## How entries get into briefs

When ready, populate building blocks and pages. The brief assembler in
\`src/assembly/brief.ts\` will then include a "Relevant Product Knowledge"
section in customer context briefs.
`;

export function scaffoldProductManual(): ScaffoldResult {
  const root = join(mitableHome(), "product");
  const subdirs = [
    "",
    "building-blocks",
    "building-blocks/configuration-primitives",
    "building-blocks/integrations",
    "building-blocks/mcp-tools",
    "pages",
  ];

  const created: string[] = [];
  const alreadyPresent: string[] = [];

  for (const sub of subdirs) {
    const p = join(root, sub);
    if (existsSync(p)) {
      alreadyPresent.push(p);
    } else {
      mkdirSync(p, { recursive: true });
      created.push(p);
    }
  }

  const readmePath = join(root, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, README_BODY);
    created.push(readmePath);
  } else {
    alreadyPresent.push(readmePath);
  }

  return {
    product_root: root,
    created,
    already_present: alreadyPresent,
    message:
      "Product Manual scaffolded. This layer is manually authored — populate building-blocks/ and pages/ with the team. The classifier will never write here.",
  };
}
