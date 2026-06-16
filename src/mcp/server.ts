/**
 * Mitable MCP server.
 *
 * v1 surface (this file grows with each milestone):
 *   - ping                              — milestone 2
 *   - brief, seed_fixture, list_customers — milestone 3
 *   - list_pending_classifications,
 *     drain_classifications,
 *     classify_one_session              — milestone 5 (this file)
 *   - sweep_now                         — milestone 6
 *   - open_command_center               — milestone 8
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
import {
  listPending,
  markFailed,
  markInProgress,
  markDone,
  markSkipped,
  queueCounts,
  type QueueRow,
} from "../store/classify-queue.js";
import { classifyTranscript } from "../classify/transcript.js";

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
    {
      name: "list_pending_classifications",
      description:
        "Show sessions queued by the SessionEnd hook that are waiting to be classified into the event log. Returns the rows plus aggregate queue counts (pending/in_progress/done/failed/skipped).",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max rows to return. Defaults to 20.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "classify_one_session",
      description:
        "Classify a single queued session and write high-confidence extractions to the event log. Spawns `claude -p` with the classifier prompt. Requires the customer_id (either passed inline or set on the queue row by an earlier /mitable invocation).",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Queue row to classify. Must exist with status='pending'.",
          },
          customer_id: {
            type: "string",
            description:
              "Customer to attribute extractions to. Overrides the queue row's customer_id_hint.",
          },
        },
        required: ["session_id"],
        additionalProperties: false,
      },
    },
    {
      name: "drain_classifications",
      description:
        "Process the pending-classification queue. For each row that has a resolvable customer_id (from the queue row or the customer_id param), spawn `claude -p` and write extractions. Returns per-session results. v1: sequential, manual. The scheduler in milestone 6 will call this automatically.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: {
            type: "string",
            description:
              "If set, applied to every pending row whose customer_id_hint is empty. Use when draining a batch you know belongs to one customer.",
          },
          limit: {
            type: "number",
            description: "Max rows to process this call. Defaults to 5.",
          },
        },
        additionalProperties: false,
      },
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

      case "list_pending_classifications": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        return json({ counts: queueCounts(), rows: listPending(limit) });
      }

      case "classify_one_session": {
        const sessionId = requireString(args, "session_id");
        const customer = typeof args.customer_id === "string" ? args.customer_id : undefined;
        const row = findPendingRow(sessionId);
        const result = await classifyOne(row, customer);
        return json(result);
      }

      case "drain_classifications": {
        const customer = typeof args.customer_id === "string" ? args.customer_id : undefined;
        const limit = typeof args.limit === "number" ? args.limit : 5;
        const rows = listPending(limit);
        const results = [];
        for (const row of rows) {
          results.push(await classifyOne(row, customer));
        }
        return json({ processed: results.length, results });
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

function findPendingRow(sessionId: string): QueueRow | null {
  const rows = listPending(10_000);
  return rows.find((r) => r.session_id === sessionId) ?? null;
}

type ClassifyOneResult =
  | { session_id: string; status: "skipped"; reason: string }
  | { session_id: string; status: "failed"; reason: string }
  | {
      session_id: string;
      status: "done";
      customer_id: string;
      task_type: string | null;
      outcome: string | null;
      extractions_written: number;
      extractions_rejected: number;
    };

async function classifyOne(
  row: QueueRow | null,
  customerOverride: string | undefined,
): Promise<ClassifyOneResult> {
  if (!row) {
    return { session_id: "", status: "skipped", reason: "row_not_found" };
  }
  const customerId = customerOverride ?? row.customer_id_hint ?? null;
  if (!customerId) {
    markSkipped(row.session_id, "no_customer_id");
    return { session_id: row.session_id, status: "skipped", reason: "no_customer_id" };
  }
  if (!row.transcript_path) {
    markSkipped(row.session_id, "no_transcript_path");
    return { session_id: row.session_id, status: "skipped", reason: "no_transcript_path" };
  }

  markInProgress(row.session_id);
  try {
    const result = await classifyTranscript({
      session_id: row.session_id,
      transcript_path: row.transcript_path,
      customer_id: customerId,
    });
    markDone(row.session_id);
    return {
      session_id: row.session_id,
      status: "done",
      customer_id: result.customer_id,
      task_type: result.task_type,
      outcome: result.outcome,
      extractions_written: result.extractions_written,
      extractions_rejected: result.extractions_rejected,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markFailed(row.session_id, msg);
    return { session_id: row.session_id, status: "failed", reason: msg };
  }
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
