/**
 * Mitable MCP server.
 *
 * v1 surface (this file grows with each milestone):
 *   - ping                              — milestone 2
 *   - brief, seed_fixture, list_customers — milestone 3
 *   - list_pending_classifications,
 *     drain_classifications,
 *     classify_one_session              — milestone 5
 *   - sweep_now, list_channels,
 *     add_channel, pause_channel,
 *     resume_channel, remove_channel    — milestone 6 (this file)
 *   - open_command_center               — milestone 8
 *
 * Anything written to stdout is MCP protocol traffic — logs go to stderr.
 *
 * The scheduler (in-process 5-min sweep loop) is gated behind
 * MITABLE_SCHEDULER=1 because the v1 SlackClient is a stub. Enable once a
 * real Slack adapter is wired.
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
import { appendEvent, ensureCustomer, listCustomers } from "../store/event-log.js";
import { PROFILE_FIELDS, type ProfileField } from "../store/schema.js";
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
import {
  addChannel,
  listChannels,
  pauseChannel,
  removeChannel,
  resumeChannel,
} from "../store/channel-map.js";
import { sweepSlack } from "../ingest/slack.js";
import { StubSlackClient } from "../ingest/slack-adapter.js";
import { sweepGranola } from "../ingest/granola.js";
import { StubGranolaClient } from "../ingest/granola-adapter.js";
import {
  addMeeting,
  listMeetings,
  pauseMeeting,
  removeMeeting,
  resumeMeeting,
} from "../store/granola-map.js";
import { startScheduler, schedulerEnabled } from "../ingest/scheduler.js";
import { startCommandCenter, commandCenterUrl } from "../web/server.js";
import { scaffoldProductManual } from "../product/build-stub.js";

const server = new Server(
  { name: "mitable", version: "0.1.1" },
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
      name: "add_customer",
      description:
        "Create a customer in the event log so /mitable <customer> has somewhere to write. Idempotent — calling on an existing customer is a no-op. Use this before sweeping Slack/Granola or pasting notes for a new customer.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: {
            type: "string",
            description: "Short slug, e.g. 'acme-bakery'. Used in /mitable <id>.",
          },
          display_name: {
            type: "string",
            description: "Human-readable name shown in the brief header. Defaults to the customer_id.",
          },
          one_liner: {
            type: "string",
            description: "Optional short description shown in the command center.",
          },
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
    {
      name: "add_note",
      description:
        "Write a single profile entry to the event log directly. Use when the FDE wants to record something they observed manually — a meeting takeaway, a quick fact a customer mentioned, a config detail from a deploy. The content is treated as 'fde_manual' provenance (no evidence quote required, dedup skipped). NOT a classifier path — for that, use drain_classifications or sweep_now.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Must already exist (use add_customer first)." },
          profile_field: {
            type: "string",
            enum: [...PROFILE_FIELDS],
            description: "Which of the eleven Customer Profile fields this entry belongs to.",
          },
          content: {
            type: "string",
            description: "One-sentence self-contained assertion. Will be shown verbatim in briefs.",
          },
          confidence: {
            type: "number",
            description: "0.0–1.0. Defaults to 1.0 for FDE-authored notes. Must be ≥ 0.7 to write.",
          },
        },
        required: ["customer_id", "profile_field", "content"],
        additionalProperties: false,
      },
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
    {
      name: "list_channels",
      description:
        "List Slack channel ↔ customer mappings. Each entry shows whether the channel is currently active (swept) or paused. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "add_channel",
      description:
        "Add a Slack channel to the channel map and associate it with a customer. v1: only one customer per channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "Slack channel ID, e.g. C0123456." },
          channel_name: { type: "string", description: "Human-readable channel name, e.g. #carver-support." },
          customer_id: { type: "string", description: "Customer to associate this channel with." },
        },
        required: ["channel_id", "channel_name", "customer_id"],
        additionalProperties: false,
      },
    },
    {
      name: "pause_channel",
      description: "Stop sweeping a channel without removing the mapping. Past entries retained.",
      inputSchema: {
        type: "object",
        properties: { channel_id: { type: "string" } },
        required: ["channel_id"],
        additionalProperties: false,
      },
    },
    {
      name: "resume_channel",
      description: "Resume sweeping a previously paused channel.",
      inputSchema: {
        type: "object",
        properties: { channel_id: { type: "string" } },
        required: ["channel_id"],
        additionalProperties: false,
      },
    },
    {
      name: "remove_channel",
      description:
        "Remove a Slack channel from the map. Past extractions stay in the event log; the channel just stops getting swept.",
      inputSchema: {
        type: "object",
        properties: { channel_id: { type: "string" } },
        required: ["channel_id"],
        additionalProperties: false,
      },
    },
    {
      name: "sweep_now",
      description:
        "Run a sweep across all background sources (Slack channels + Granola meetings) for one customer or all customers. Useful for testing the pipeline before the scheduler is enabled. v1 ships with stub clients that return no new content — wire real adapters to see real results.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Limit the sweep to one customer's sources." },
          dry_run: {
            type: "boolean",
            description: "If true, walk the sources but do not classify or write.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "list_meetings",
      description:
        "List Granola meeting ↔ customer mappings. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "add_meeting",
      description:
        "Map a Granola meeting (or calendar event) to a customer. Used for assigning recurring meetings whose attendee heuristic isn't sufficient.",
      inputSchema: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "Granola meeting or calendar-event ID." },
          title: { type: "string", description: "Human-readable title, e.g. 'Carver weekly sync'." },
          customer_id: { type: "string" },
          type: {
            type: "string",
            enum: ["meeting", "calendar_event"],
            description: "Defaults to 'meeting'.",
          },
        },
        required: ["meeting_id", "title", "customer_id"],
        additionalProperties: false,
      },
    },
    {
      name: "pause_meeting",
      description: "Stop sweeping a meeting without removing the mapping.",
      inputSchema: {
        type: "object",
        properties: { meeting_id: { type: "string" } },
        required: ["meeting_id"],
        additionalProperties: false,
      },
    },
    {
      name: "resume_meeting",
      description: "Resume sweeping a paused meeting.",
      inputSchema: {
        type: "object",
        properties: { meeting_id: { type: "string" } },
        required: ["meeting_id"],
        additionalProperties: false,
      },
    },
    {
      name: "remove_meeting",
      description: "Remove a meeting mapping. Past extractions stay in the event log.",
      inputSchema: {
        type: "object",
        properties: { meeting_id: { type: "string" } },
        required: ["meeting_id"],
        additionalProperties: false,
      },
    },
    {
      name: "open_command_center",
      description:
        "Start the local command-center web UI (if not already running) and return its URL. The /mitable (no-arg) skill calls this and then asks the user to open the URL in a browser. Bound to 127.0.0.1.",
      inputSchema: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "Optional fixed port. Defaults to OS-assigned (0).",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "scaffold_product_manual",
      description:
        "Create the directory tree at $MITABLE_HOME/product/ for canonical product knowledge (building blocks, pages) and write a README explaining how to populate it. Idempotent. Does NOT generate content — the Product Manual is intentionally manually authored.",
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
        return text("pong — mitable 0.1.1");

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

      case "add_customer": {
        const customer_id = requireString(args, "customer_id");
        const display_name =
          typeof args.display_name === "string" && args.display_name !== ""
            ? args.display_name
            : customer_id;
        const one_liner = typeof args.one_liner === "string" ? args.one_liner : null;
        ensureCustomer(customer_id, display_name, one_liner);
        return json({ customer_id, display_name, one_liner });
      }

      case "add_note": {
        const customer_id = requireString(args, "customer_id");
        const profile_field = requireString(args, "profile_field");
        const content = requireString(args, "content");
        const confidence = typeof args.confidence === "number" ? args.confidence : 1.0;

        if (!(PROFILE_FIELDS as readonly string[]).includes(profile_field)) {
          return errorText(
            `unknown profile_field: ${profile_field}. Must be one of: ${PROFILE_FIELDS.join(", ")}`,
          );
        }

        const result = appendEvent({
          customer_id,
          profile_field: profile_field as ProfileField,
          content,
          source_type: "fde_manual",
          source_ref: `note:${Date.now()}`,
          source_url: null,
          evidence_text: "",
          confidence,
          origin_ts: Date.now(),
          provenance: "fde_reported",
        });
        return json(result);
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

      case "list_channels":
        return json(listChannels());

      case "add_channel": {
        addChannel({
          channel_id: requireString(args, "channel_id"),
          channel_name: requireString(args, "channel_name"),
          customer_id: requireString(args, "customer_id"),
        });
        return text(`added: ${args.channel_id}`);
      }

      case "pause_channel": {
        const ok = pauseChannel(requireString(args, "channel_id"));
        return text(ok ? `paused: ${args.channel_id}` : `not found: ${args.channel_id}`);
      }

      case "resume_channel": {
        const ok = resumeChannel(requireString(args, "channel_id"));
        return text(ok ? `resumed: ${args.channel_id}` : `not found: ${args.channel_id}`);
      }

      case "remove_channel": {
        const ok = removeChannel(requireString(args, "channel_id"));
        return text(ok ? `removed: ${args.channel_id}` : `not found: ${args.channel_id}`);
      }

      case "sweep_now": {
        const customer = typeof args.customer_id === "string" ? args.customer_id : undefined;
        const dryRun = args.dry_run === true;
        const slack = await sweepSlack({
          client: new StubSlackClient(),
          customer_id: customer,
          dry_run: dryRun,
        });
        const granola = await sweepGranola({
          client: new StubGranolaClient(),
          customer_id: customer,
          dry_run: dryRun,
        });
        return json({ slack, granola });
      }

      case "list_meetings":
        return json(listMeetings());

      case "add_meeting": {
        addMeeting({
          meeting_id: requireString(args, "meeting_id"),
          title: requireString(args, "title"),
          customer_id: requireString(args, "customer_id"),
          type: args.type === "calendar_event" ? "calendar_event" : "meeting",
        });
        return text(`added: ${args.meeting_id}`);
      }

      case "pause_meeting": {
        const ok = pauseMeeting(requireString(args, "meeting_id"));
        return text(ok ? `paused: ${args.meeting_id}` : `not found: ${args.meeting_id}`);
      }

      case "resume_meeting": {
        const ok = resumeMeeting(requireString(args, "meeting_id"));
        return text(ok ? `resumed: ${args.meeting_id}` : `not found: ${args.meeting_id}`);
      }

      case "remove_meeting": {
        const ok = removeMeeting(requireString(args, "meeting_id"));
        return text(ok ? `removed: ${args.meeting_id}` : `not found: ${args.meeting_id}`);
      }

      case "open_command_center": {
        const existing = commandCenterUrl();
        if (existing) return json({ url: existing, already_running: true });
        const port = typeof args.port === "number" ? args.port : undefined;
        const url = await startCommandCenter({ port });
        return json({ url, already_running: false });
      }

      case "scaffold_product_manual":
        return json(scaffoldProductManual());

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

  if (schedulerEnabled()) {
    const handle = startScheduler({
      on_tick: (r) =>
        process.stderr.write(
          `[mitable] scheduler tick: slack(ch=${r.slack.channels_examined} wr=${r.slack.extractions_written}) granola(mt=${r.granola.meetings_examined} wr=${r.granola.extractions_written}) errs=${r.slack.errors.length + r.granola.errors.length}\n`,
        ),
      on_error: (err) =>
        process.stderr.write(`[mitable] scheduler error: ${err instanceof Error ? err.message : err}\n`),
    });
    process.on("SIGTERM", () => handle.stop());
    process.on("SIGINT", () => handle.stop());
    process.stderr.write("[mitable] scheduler started (MITABLE_SCHEDULER=1)\n");
  }
}

main().catch((err) => {
  process.stderr.write(`[mitable] mcp server crashed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
