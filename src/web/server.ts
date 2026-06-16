/**
 * Command-center HTTP server.
 *
 * Spec: docs/06-interaction-model.md §3.
 *
 * Runs in-process alongside the MCP server. Started lazily by the
 * `open_command_center` MCP tool (so we don't bind a port until the user
 * actually opens the UI).
 *
 * Surfaces:
 *   GET  /                       overview + status header + customer list
 *   GET  /customers/:id          profile view (all eleven fields)
 *   GET  /sources                Slack + Granola maps with CRUD forms
 *   POST /channels               add
 *   POST /channels/:id/pause     pause / resume / remove
 *   POST /meetings               add
 *   POST /meetings/:id/...       pause / resume / remove
 *   GET  /queue                  classification queue
 *
 * Read-only beyond the source-config writes. There is NO endpoint for
 * editing the event log directly — that's by design, per the
 * "humans decide, system memorizes" philosophy.
 *
 * Bound to 127.0.0.1 only. Data is sensitive; no LAN exposure.
 */
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";

import {
  activeChannels,
  addChannel,
  lastChannelSweep,
  listChannels,
  pauseChannel,
  removeChannel,
  resumeChannel,
} from "../store/channel-map.js";
import {
  addMeeting,
  lastMeetingSweep,
  listMeetings,
  pauseMeeting,
  removeMeeting,
  resumeMeeting,
} from "../store/granola-map.js";
import { listCustomers, materializeProfile } from "../store/event-log.js";
import { PROFILE_FIELDS, type ProfileField } from "../store/schema.js";
import { listPending, queueCounts } from "../store/classify-queue.js";
import {
  renderCustomer,
  renderIndex,
  renderQueue,
  renderSources,
  type StatusHeader,
} from "./templates.js";

const DEFAULT_PORT = Number(process.env.MITABLE_WEB_PORT ?? "0"); // 0 = OS-assigned
const HOST = "127.0.0.1";

let server: ServerType | null = null;
let serverUrl: string | null = null;

function buildStatusHeader(): StatusHeader {
  return {
    last_slack_sweep: lastChannelSweep(),
    last_granola_sweep: lastMeetingSweep(),
    // We don't have a live ping result cached. Showing null = "unknown" until
    // the next sweep runs, which is honest. The scheduler can update a tiny
    // in-memory cache in a later refinement.
    slack_auth_ok: null,
    granola_auth_ok: null,
    queue_counts: queueCounts(),
  };
}

function buildApp(): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.html(
      renderIndex({
        customers: listCustomers(),
        statusHeader: buildStatusHeader(),
      }),
    );
  });

  app.get("/customers/:id", (c) => {
    const id = c.req.param("id");
    const customer = listCustomers().find((x) => x.customer_id === id);
    if (!customer) return c.html(notFound(`No customer '${id}'.`), 404);
    const rows = materializeProfile(id);
    const grouped = new Map<ProfileField, typeof rows>();
    for (const f of PROFILE_FIELDS) grouped.set(f, []);
    for (const r of rows) grouped.get(r.profile_field as ProfileField)?.push(r);

    return c.html(
      renderCustomer({
        customer_id: customer.customer_id,
        display_name: customer.display_name,
        one_liner: customer.one_liner,
        entries_by_field: grouped,
      }),
    );
  });

  app.get("/sources", (c) => {
    return c.html(
      renderSources({
        channels: listChannels(),
        meetings: listMeetings(),
        customers: listCustomers(),
      }),
    );
  });

  app.post("/channels", async (c) => {
    const body = await c.req.parseBody();
    const channel_id = strOrEmpty(body.channel_id);
    const channel_name = strOrEmpty(body.channel_name);
    const customer_id = strOrEmpty(body.customer_id);
    if (!channel_id || !channel_name || !customer_id) {
      return c.html(badRequest("channel_id, channel_name, customer_id required"), 400);
    }
    addChannel({ channel_id, channel_name, customer_id });
    return c.redirect("/sources");
  });

  app.post("/channels/:id/pause", (c) => {
    pauseChannel(c.req.param("id"));
    return c.redirect("/sources");
  });
  app.post("/channels/:id/resume", (c) => {
    resumeChannel(c.req.param("id"));
    return c.redirect("/sources");
  });
  app.post("/channels/:id/remove", (c) => {
    removeChannel(c.req.param("id"));
    return c.redirect("/sources");
  });

  app.post("/meetings", async (c) => {
    const body = await c.req.parseBody();
    const meeting_id = strOrEmpty(body.meeting_id);
    const title = strOrEmpty(body.title);
    const customer_id = strOrEmpty(body.customer_id);
    const type = strOrEmpty(body.type) === "calendar_event" ? "calendar_event" : "meeting";
    if (!meeting_id || !title || !customer_id) {
      return c.html(badRequest("meeting_id, title, customer_id required"), 400);
    }
    addMeeting({ meeting_id, title, customer_id, type });
    return c.redirect("/sources");
  });

  app.post("/meetings/:id/pause", (c) => {
    pauseMeeting(c.req.param("id"));
    return c.redirect("/sources");
  });
  app.post("/meetings/:id/resume", (c) => {
    resumeMeeting(c.req.param("id"));
    return c.redirect("/sources");
  });
  app.post("/meetings/:id/remove", (c) => {
    removeMeeting(c.req.param("id"));
    return c.redirect("/sources");
  });

  app.get("/queue", (c) => {
    return c.html(
      renderQueue({
        counts: queueCounts(),
        rows: listPending(100).map((r) => ({
          session_id: r.session_id,
          transcript_path: r.transcript_path,
          customer_id_hint: r.customer_id_hint,
          queued_at: r.queued_at,
          status: r.status,
          attempts: r.attempts,
          last_error: r.last_error,
        })),
      }),
    );
  });

  // Touch activeChannels so its import isn't dead-stripped. (Used implicitly
  // by the scan path; the web layer doesn't need it but we keep the import
  // consistent with the rest of the channel-map surface to make refactors easier.)
  void activeChannels;

  return app;
}

export interface StartOptions {
  port?: number;
  silent?: boolean;
}

/**
 * Lazy-start the command center. Idempotent: calling twice returns the same URL.
 * Returns the URL to open in the browser.
 */
export async function startCommandCenter(opts: StartOptions = {}): Promise<string> {
  if (server && serverUrl) return serverUrl;

  const app = buildApp();
  const port = opts.port ?? DEFAULT_PORT;

  return new Promise((resolve, reject) => {
    try {
      server = serve(
        {
          fetch: app.fetch,
          hostname: HOST,
          port,
        },
        (info) => {
          serverUrl = `http://${HOST}:${info.port}`;
          if (!opts.silent) {
            process.stderr.write(`[mitable] command center: ${serverUrl}\n`);
          }
          resolve(serverUrl);
        },
      );
      server.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

export function stopCommandCenter(): void {
  if (server) {
    server.close();
    server = null;
    serverUrl = null;
  }
}

export function commandCenterUrl(): string | null {
  return serverUrl;
}

// ---------- tiny helpers ----------

function strOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function notFound(msg: string): string {
  return `<!doctype html><title>Not found</title><body style="font-family:sans-serif;padding:24px;"><h1>404</h1><p>${escapeHtml(msg)}</p><a href="/">← back</a></body>`;
}

function badRequest(msg: string): string {
  return `<!doctype html><title>Bad request</title><body style="font-family:sans-serif;padding:24px;"><h1>400</h1><p>${escapeHtml(msg)}</p><a href="/sources">← back</a></body>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
