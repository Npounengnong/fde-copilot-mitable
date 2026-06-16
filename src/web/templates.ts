/**
 * Server-rendered HTML for the command center.
 *
 * Deliberately no build step, no JS framework. The command center is an
 * observability surface (docs/06-interaction-model.md §3) — small forms,
 * read-only data tables. Plain HTML + a few inline scripts is the right
 * shape and matches the no-bundle feel of the rest of the codebase.
 *
 * If the UX grows beyond what plain HTML handles cleanly, swap in Vite
 * without changing the HTTP API.
 */
import type { EventRow } from "../store/event-log.js";
import { PROFILE_FIELDS, type ProfileField } from "../store/schema.js";
import type { ChannelMapping } from "../store/channel-map.js";
import type { GranolaMapping } from "../store/granola-map.js";
import type { QueueStatus } from "../store/classify-queue.js";

const CSS = `
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #666;
  --border: #e5e5e5;
  --accent: #1d4ed8;
  --warn: #b45309;
  --ok: #047857;
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
}
.container { max-width: 960px; margin: 0 auto; padding: 24px; }
header {
  border-bottom: 1px solid var(--border);
  padding: 16px 24px;
  display: flex;
  align-items: baseline;
  gap: 24px;
}
header h1 { font-size: 18px; margin: 0; font-weight: 600; }
header nav a { color: var(--muted); text-decoration: none; margin-right: 16px; }
header nav a:hover { color: var(--accent); }
h2 { font-size: 16px; margin: 32px 0 12px; font-weight: 600; }
h3 { font-size: 14px; margin: 24px 0 8px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.tag {
  display: inline-block;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  background: #f3f4f6;
  color: var(--muted);
  margin-right: 4px;
}
.tag.active { background: #ecfdf5; color: var(--ok); }
.tag.paused { background: #fef3c7; color: var(--warn); }
.evidence {
  font-size: 13px;
  color: var(--muted);
  font-style: italic;
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--border);
}
form { margin: 12px 0; }
form input, form select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 14px;
  margin-right: 4px;
}
form button {
  padding: 6px 12px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: white;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
}
form button.secondary {
  background: white;
  color: var(--muted);
  border-color: var(--border);
}
.muted { color: var(--muted); font-size: 13px; }
.status {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}
.empty { color: var(--muted); font-size: 14px; padding: 12px 0; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Mitable</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Mitable</h1>
  <nav>
    <a href="/">Overview</a>
    <a href="/sources">Sources</a>
    <a href="/queue">Queue</a>
  </nav>
</header>
<div class="container">
${body}
</div>
</body>
</html>`;
}

export interface IndexInput {
  customers: Array<{ customer_id: string; display_name: string; one_liner: string | null }>;
  statusHeader: StatusHeader;
}

export interface StatusHeader {
  last_slack_sweep: number | null;
  last_granola_sweep: number | null;
  slack_auth_ok: boolean | null;
  granola_auth_ok: boolean | null;
  queue_counts: Record<QueueStatus, number>;
}

export function renderIndex(input: IndexInput): string {
  const status = renderStatus(input.statusHeader);
  const list =
    input.customers.length === 0
      ? `<p class="empty">No customers yet. Seed a fixture with the seed_fixture MCP tool or configure a Slack channel / Granola meeting under <a href="/sources">Sources</a>.</p>`
      : `<table>
<thead><tr><th>Customer</th><th>One-liner</th><th></th></tr></thead>
<tbody>
${input.customers
  .map(
    (c) => `<tr>
  <td><a href="/customers/${escapeHtml(c.customer_id)}">${escapeHtml(c.display_name)}</a></td>
  <td class="muted">${escapeHtml(c.one_liner ?? "")}</td>
  <td><a href="/customers/${escapeHtml(c.customer_id)}" class="muted">view profile →</a></td>
</tr>`,
  )
  .join("")}
</tbody>
</table>`;

  return layout("Overview", `${status}<h2>Customers</h2>${list}`);
}

function renderStatus(s: StatusHeader): string {
  return `<div class="status">
  <span><b>Slack</b> ${authBadge(s.slack_auth_ok)} ${tsBadge("last sweep", s.last_slack_sweep)}</span>
  <span><b>Granola</b> ${authBadge(s.granola_auth_ok)} ${tsBadge("last sweep", s.last_granola_sweep)}</span>
  <span><b>Queue</b> pending=${s.queue_counts.pending} done=${s.queue_counts.done} failed=${s.queue_counts.failed}</span>
</div>`;
}

function authBadge(ok: boolean | null): string {
  if (ok === null) return `<span class="tag">auth ?</span>`;
  return ok ? `<span class="tag active">auth ✓</span>` : `<span class="tag paused">auth ✗</span>`;
}

function tsBadge(label: string, unixMs: number | null): string {
  if (!unixMs) return `<span class="tag">${escapeHtml(label)}: never</span>`;
  return `<span class="tag">${escapeHtml(label)}: ${formatRelative(unixMs)}</span>`;
}

export interface CustomerViewInput {
  customer_id: string;
  display_name: string;
  one_liner: string | null;
  entries_by_field: Map<ProfileField, EventRow[]>;
}

export function renderCustomer(input: CustomerViewInput): string {
  const sections = PROFILE_FIELDS.map((field) => {
    const rows = input.entries_by_field.get(field) ?? [];
    if (rows.length === 0) {
      return `<section><h3>${escapeHtml(field)}</h3><p class="empty">No entries.</p></section>`;
    }
    return `<section>
<h3>${escapeHtml(field)} <span class="tag">${rows.length}</span></h3>
${rows.map(renderEntry).join("")}
</section>`;
  }).join("");

  const oneLiner = input.one_liner
    ? `<p class="muted">${escapeHtml(input.one_liner)}</p>`
    : "";

  return layout(
    input.display_name,
    `<a href="/" class="muted">← all customers</a>
<h2>${escapeHtml(input.display_name)}</h2>
${oneLiner}
${sections}`,
  );
}

function renderEntry(e: EventRow): string {
  const meta = `${formatDate(e.origin_ts)} · ${e.source_type} · ${e.provenance}`;
  const evidence =
    e.evidence_text && e.source_type !== "fde_manual"
      ? `<div class="evidence">${escapeHtml(truncate(e.evidence_text, 240))}</div>`
      : "";
  return `<div style="margin: 8px 0;">
  <div>${escapeHtml(truncate(e.content, 600))}</div>
  <div class="muted" style="font-size:12px;">${escapeHtml(meta)}</div>
  ${evidence}
</div>`;
}

export interface SourcesViewInput {
  channels: Array<ChannelMapping & { channel_id: string }>;
  meetings: Array<GranolaMapping & { meeting_id: string }>;
  customers: Array<{ customer_id: string; display_name: string }>;
}

export function renderSources(input: SourcesViewInput): string {
  const customerOptions = input.customers
    .map((c) => `<option value="${escapeHtml(c.customer_id)}">${escapeHtml(c.display_name)}</option>`)
    .join("");

  const chRows =
    input.channels.length === 0
      ? `<tr><td colspan="4" class="muted">No channels mapped.</td></tr>`
      : input.channels
          .map(
            (c) => `<tr>
  <td><code>${escapeHtml(c.channel_id)}</code></td>
  <td>${escapeHtml(c.channel_name)}</td>
  <td><a href="/customers/${escapeHtml(c.customer_id)}">${escapeHtml(c.customer_id)}</a></td>
  <td>
    ${c.active ? `<span class="tag active">active</span>` : `<span class="tag paused">paused</span>`}
    <form method="POST" action="/channels/${escapeHtml(c.channel_id)}/${c.active ? "pause" : "resume"}" style="display:inline">
      <button class="secondary" type="submit">${c.active ? "Pause" : "Resume"}</button>
    </form>
    <form method="POST" action="/channels/${escapeHtml(c.channel_id)}/remove" style="display:inline" onsubmit="return confirm('Remove this channel mapping? Past extractions stay in the event log.')">
      <button class="secondary" type="submit">Remove</button>
    </form>
  </td>
</tr>`,
          )
          .join("");

  const mtRows =
    input.meetings.length === 0
      ? `<tr><td colspan="5" class="muted">No meetings mapped.</td></tr>`
      : input.meetings
          .map(
            (m) => `<tr>
  <td><code>${escapeHtml(m.meeting_id)}</code></td>
  <td>${escapeHtml(m.title)}</td>
  <td><span class="tag">${escapeHtml(m.type)}</span></td>
  <td><a href="/customers/${escapeHtml(m.customer_id)}">${escapeHtml(m.customer_id)}</a></td>
  <td>
    ${m.active ? `<span class="tag active">active</span>` : `<span class="tag paused">paused</span>`}
    <form method="POST" action="/meetings/${escapeHtml(m.meeting_id)}/${m.active ? "pause" : "resume"}" style="display:inline">
      <button class="secondary" type="submit">${m.active ? "Pause" : "Resume"}</button>
    </form>
    <form method="POST" action="/meetings/${escapeHtml(m.meeting_id)}/remove" style="display:inline" onsubmit="return confirm('Remove this meeting mapping?')">
      <button class="secondary" type="submit">Remove</button>
    </form>
  </td>
</tr>`,
          )
          .join("");

  return layout(
    "Sources",
    `<h2>Slack channels</h2>
<table>
<thead><tr><th>Channel ID</th><th>Name</th><th>Customer</th><th>Status</th></tr></thead>
<tbody>${chRows}</tbody>
</table>
<form method="POST" action="/channels" style="margin-top: 16px;">
  <input name="channel_id" placeholder="C0123456" required>
  <input name="channel_name" placeholder="#carver-support" required>
  <select name="customer_id" required>
    <option value="">customer…</option>
    ${customerOptions}
  </select>
  <button type="submit">Add channel</button>
</form>

<h2>Granola meetings</h2>
<table>
<thead><tr><th>Meeting ID</th><th>Title</th><th>Type</th><th>Customer</th><th>Status</th></tr></thead>
<tbody>${mtRows}</tbody>
</table>
<form method="POST" action="/meetings" style="margin-top: 16px;">
  <input name="meeting_id" placeholder="meeting:abc123" required>
  <input name="title" placeholder="Carver weekly sync" required>
  <select name="type">
    <option value="meeting">meeting</option>
    <option value="calendar_event">calendar_event</option>
  </select>
  <select name="customer_id" required>
    <option value="">customer…</option>
    ${customerOptions}
  </select>
  <button type="submit">Add meeting</button>
</form>`,
  );
}

export interface QueueViewInput {
  counts: Record<QueueStatus, number>;
  rows: Array<{
    session_id: string;
    transcript_path: string | null;
    customer_id_hint: string | null;
    queued_at: number;
    status: QueueStatus;
    attempts: number;
    last_error: string | null;
  }>;
}

export function renderQueue(input: QueueViewInput): string {
  const summary = `<div class="status">
  <span><b>Pending</b> ${input.counts.pending}</span>
  <span><b>In progress</b> ${input.counts.in_progress}</span>
  <span><b>Done</b> ${input.counts.done}</span>
  <span><b>Failed</b> ${input.counts.failed}</span>
  <span><b>Skipped</b> ${input.counts.skipped}</span>
</div>`;
  const rows =
    input.rows.length === 0
      ? `<p class="empty">Queue is empty.</p>`
      : `<table>
<thead><tr><th>Session</th><th>Customer hint</th><th>Queued</th><th>Attempts</th><th>Last error</th></tr></thead>
<tbody>
${input.rows
  .map(
    (r) => `<tr>
  <td><code>${escapeHtml(r.session_id.slice(0, 12))}…</code></td>
  <td>${escapeHtml(r.customer_id_hint ?? "—")}</td>
  <td class="muted">${formatRelative(r.queued_at)}</td>
  <td>${r.attempts}</td>
  <td class="muted">${escapeHtml(r.last_error ?? "")}</td>
</tr>`,
  )
  .join("")}
</tbody>
</table>`;

  return layout("Queue", `<h2>Classification queue</h2>${summary}${rows}<p class="muted">To drain, call the <code>drain_classifications</code> MCP tool from a Claude Code session.</p>`);
}

// ---------- helpers ----------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, limit: number): string {
  const t = s.trim();
  if (t.length <= limit) return t;
  return `${t.slice(0, limit - 1)}…`;
}

function formatDate(unixMs: number): string {
  return new Date(unixMs).toISOString().slice(0, 10);
}

function formatRelative(unixMs: number): string {
  const diff = Date.now() - unixMs;
  if (diff < 0) return "in the future";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
