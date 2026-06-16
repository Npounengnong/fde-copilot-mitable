/**
 * Mitable MCP server.
 *
 * v1 surface (this file grows with each milestone):
 *   - ping                   — sanity check (milestone 2)
 *   - brief                  — milestone 3, this file
 *   - seed_fixture           — milestone 3, this file
 *   - list_customers         — milestone 3, this file
 *   - profile_read/write     — milestone 5
 *   - sweep_now              — milestone 6
 *   - open_command_center    — milestone 8
 *
 * Anything written to stdout is MCP protocol traffic — logs go to stderr.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";

import { renderBrief } from "../assembly/brief.js";
import { parseMode, WORK_MODES } from "../assembly/work-mode.js";
import { listCustomers } from "../store/event-log.js";
import { seedFixture } from "../store/seed-fixture.js";

const server = new Server(
  { name: "mitable", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description:
        "Health check. Returns 'pong' with the server version. Used to verify the plugin loaded.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "brief",
      description:
        "Render the customer-context brief for a customer + work mode. Returns markdown formatted per docs/06-interaction-model.md §4. The /mitable <customer> skill calls this.",
      inputSchema: {
        type: "object",
        properties: {
          customer: {
            type: "string",
            description: "Customer ID (e.g. 'carver'). Must match a row in the customers table.",
          },
          mode: {
            type: "string",
            enum: [...WORK_MODES],
            description: "Work mode. Defaults to 'investigate' if omitted.",
          },
          display_name: {
            type: "string",
            description: "Optional display name for the brief header. Defaults to the customer ID.",
          },
        },
        required: ["customer"],
        additionalProperties: false,
      },
    },
    {
      name: "seed_fixture",
      description:
        "Load a customer-profile fixture directory (one *.txt per field) into the event log. Used for milestone-3 smoke tests; not a production code path.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute or repo-relative path to a fixture directory (e.g. refs/carver-customer-profile).",
          },
          customer: {
            type: "string",
            description:
              "Optional customer ID override. Defaults to the directory basename minus '-customer-profile'.",
          },
          display_name: {
            type: "string",
            description: "Optional display name. Defaults to the customer ID capitalized.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "list_customers",
      description: "List customers currently known to the event log.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "ping":
        return text("pong — mitable 0.1.0");

      case "brief": {
        const customer = requireString(args, "customer");
        const mode = parseMode(typeof args.mode === "string" ? args.mode : undefined);
        const display_name = typeof args.display_name === "string" ? args.display_name : undefined;
        const md = renderBrief({ customer_id: customer, mode, display_name });
        return text(md);
      }

      case "seed_fixture": {
        const rawPath = requireString(args, "path");
        const path = resolve(process.cwd(), rawPath);
        const customer = typeof args.customer === "string" ? args.customer : undefined;
        const display_name = typeof args.display_name === "string" ? args.display_name : undefined;
        const result = await seedFixture({ path, customer_id: customer, display_name });
        return json(result);
      }

      case "list_customers": {
        return json(listCustomers());
      }

      default:
        return errorText(`unknown tool: ${name}`);
    }
  } catch (err) {
    return errorText(`tool '${name}' failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function json(v: unknown) {
  return text(JSON.stringify(v, null, 2));
}

function errorText(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v === "") {
    throw new Error(`missing required argument: ${key}`);
  }
  return v;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mitable] mcp server ready\n");
}

main().catch((err) => {
  process.stderr.write(`[mitable] mcp server crashed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
