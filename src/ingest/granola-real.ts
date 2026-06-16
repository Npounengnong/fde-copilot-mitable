/**
 * Real Granola adapter — proxies to the Granola REST API.
 *
 * Spec: docs/07-scan-and-store.md §1.3 (two-phase), §1.5 (auth preflight),
 * §1.6 (rate-limit recovery).
 *
 * The Granola REST API is documented at docs.granola.ai/introduction.
 *   Base: https://public-api.granola.ai/v1/
 *   Auth: Authorization: Bearer grn_...  (static API key, no expiry)
 *
 * The user generates their key in the Granola app
 * (Settings -> Connectors -> API Keys) and stores it via the
 * `set_granola_token` MCP tool.
 */

import {
  GranolaAdapterError,
  type GranolaClient,
  type GranolaNote,
  type GranolaProbeResult,
} from "./granola-adapter.js";
import { loadGranolaAuth } from "../store/granola-auth.js";

const GRANOLA_API_BASE = "https://public-api.granola.ai/v1";
const RETRY_AFTER_MS = 5000;

export class RealGranolaClient implements GranolaClient {
  async authPreflight(): Promise<boolean> {
    const token = loadGranolaAuth()?.token;
    if (!token) return false;
    try {
      // Cheap probe: list 1 note to verify the key works.
      const res = await fetch(`${GRANOLA_API_BASE}/notes?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) return false;
      // 200 or even 404 (no notes) means auth is fine.
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  async probe(opts: {
    meeting_id: string;
    oldest_ts: number;
  }): Promise<GranolaProbeResult> {
    const note = await this.fetchNoteRaw(opts.meeting_id);
    if (!note) {
      return { has_new: false, newest_ts: 0 };
    }
    const ts = noteTimestamp(note);
    if (ts <= opts.oldest_ts) {
      return { has_new: false, newest_ts: ts };
    }
    return { has_new: true, newest_ts: ts };
  }

  async fetchNote(opts: {
    meeting_id: string;
    oldest_ts: number;
  }): Promise<GranolaNote | null> {
    const raw = await this.fetchNoteRaw(opts.meeting_id);
    if (!raw) return null;

    const ts = noteTimestamp(raw);
    if (ts <= opts.oldest_ts) return null;

    const body = buildBody(raw);
    const attendees = extractAttendees(raw);

    return {
      meeting_id: opts.meeting_id,
      updated_ts: ts,
      title: raw.title ?? "Untitled",
      body,
      permalink: raw.permalink ?? undefined,
      attendees,
    };
  }

  private async fetchNoteRaw(noteId: string): Promise<RawNote | null> {
    const token = loadGranolaAuth()?.token;
    if (!token) {
      throw new GranolaAdapterError({
        kind: "auth_expired",
        message: "No Granola API token configured. Run set_granola_token.",
      });
    }

    const url = `${GRANOLA_API_BASE}/notes/${encodeURIComponent(noteId)}?include=transcript`;
    let attempt = 0;

    while (true) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        throw new GranolaAdapterError({
          kind: "other",
          message: `Network error fetching note ${noteId}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (res.status === 429) {
        if (attempt === 0) {
          const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
          await sleep(retryAfter);
          attempt++;
          continue;
        }
        throw new GranolaAdapterError({
          kind: "rate_limited",
          retry_after_seconds: Math.ceil(RETRY_AFTER_MS / 1000),
          message: `Rate limited on note ${noteId} after one retry`,
        });
      }

      if (res.status === 401 || res.status === 403) {
        throw new GranolaAdapterError({
          kind: "auth_expired",
          message: `Granola auth rejected (HTTP ${res.status}) for note ${noteId}`,
        });
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GranolaAdapterError({
          kind: "other",
          message: `Granola API error ${res.status} for note ${noteId}: ${body.slice(0, 200)}`,
        });
      }

      try {
        const json = (await res.json()) as unknown;
        if (!json || typeof json !== "object") {
          throw new Error("Non-object response");
        }
        return json as RawNote;
      } catch (err) {
        throw new GranolaAdapterError({
          kind: "other",
          message: `Failed to parse Granola response for note ${noteId}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }
}

// ---------- helpers ----------

interface RawNote {
  id?: string;
  title?: string;
  summary?: string;
  transcript?: Array<{
    speaker?: { source?: string; diarization_label?: string };
    text?: string;
  }>;
  created_at?: string;
  updated_at?: string;
  owner?: { name?: string; email?: string };
  permalink?: string;
  participants?: Array<{ name?: string; email?: string }>;
}

function noteTimestamp(raw: RawNote): number {
  // Prefer updated_at if available, otherwise created_at.
  const iso = raw.updated_at ?? raw.created_at;
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function buildBody(raw: RawNote): string {
  const parts: string[] = [];

  if (raw.title) {
    parts.push(`# ${raw.title}`);
    parts.push("");
  }

  if (raw.summary && raw.summary.trim()) {
    parts.push("## Summary");
    parts.push(raw.summary.trim());
    parts.push("");
  }

  if (raw.transcript && raw.transcript.length > 0) {
    parts.push("## Transcript");
    for (const entry of raw.transcript) {
      const speaker = entry.speaker?.diarization_label ?? "Speaker";
      const text = entry.text ?? "";
      parts.push(`${speaker}: ${text}`);
    }
  }

  return parts.join("\n") || "(empty note)";
}

function extractAttendees(raw: RawNote): string[] {
  const emails = new Set<string>();

  if (raw.owner?.email) {
    emails.add(raw.owner.email);
  }

  if (raw.participants) {
    for (const p of raw.participants) {
      if (p.email) emails.add(p.email);
    }
  }

  return Array.from(emails);
}

function parseRetryAfter(header: string | null): number {
  if (!header) return RETRY_AFTER_MS;
  const n = parseInt(header, 10);
  return Number.isFinite(n) && n > 0 ? n * 1000 : RETRY_AFTER_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- customer mapping heuristic ----------

import { listCustomers } from "../store/event-log.js";

/**
 * Try to infer a customer for an unmapped Granola meeting by matching
 * attendee email domains to registered customers.
 *
 * v1 is intentionally simple: exact domain match against a customer id.
 * If the heuristic fails, returns null — the meeting stays unassigned
 * and surfaces in the command center for manual mapping.
 */
export function inferCustomerFromAttendees(attendees: string[]): string | null {
  if (attendees.length === 0) return null;

  const customers = listCustomers();
  const domains = new Set(
    attendees
      .map((email) => email.split("@")[1]?.toLowerCase())
      .filter((d): d is string => Boolean(d)),
  );

  for (const c of customers) {
    // Exact match: customer_id == domain (e.g. "carver" matches "carver.com")
    const cid = c.customer_id.toLowerCase();
    for (const domain of domains) {
      if (domain === cid || domain === `${cid}.com` || domain.startsWith(`${cid}.`)) {
        return c.customer_id;
      }
    }
  }

  return null;
}
