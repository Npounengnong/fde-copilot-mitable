/**
 * Slack adapter — interface + stub.
 *
 * Spec: docs/07-scan-and-store.md §1.2 (two-phase), §1.5 (auth preflight),
 * §1.6 (rate-limit recovery).
 *
 * The actual Slack MCP tool surface depends on which Slack MCP server the
 * user installs (Anthropic's reference one, slack-mcp, etc.). This file
 * defines the surface Mitable depends on, so the rest of the codebase is
 * insulated from that decision.
 *
 * v1 ships ONLY the stub. The real adapter calls Slack MCP tools via the
 * agent at runtime (typically `mcp__slack__*`); it lands in a follow-up
 * once the project is connected to a real Slack workspace.
 *
 * The stub returns empty results so the scan path can be exercised end-to-end
 * without a Slack workspace, and so dry-run mode in sweep_now does the right
 * thing by default.
 */

export interface SlackMessage {
  /** Slack "ts" string, e.g. "1718123456.000100". Used as the watermark. */
  ts: string;
  user: string;
  text: string;
  /** Number of replies in the thread, if this is a parent. 0 otherwise. */
  reply_count?: number;
  /** Permalink back to the message, if known. */
  permalink?: string;
}

export interface SlackThread {
  channel_id: string;
  thread_ts: string;
  /** Parent message + replies, oldest first. */
  messages: SlackMessage[];
}

export interface ProbeResult {
  /** True iff at least one new message exists since `oldest`. */
  has_new: boolean;
  /** The newest ts encountered during the probe (empty if none). */
  newest_ts: string;
}

export type AdapterError =
  | { kind: "auth_expired"; message: string }
  | { kind: "rate_limited"; retry_after_seconds: number; message: string }
  | { kind: "other"; message: string };

export class SlackAdapterError extends Error {
  constructor(public detail: AdapterError) {
    super(detail.message);
    this.name = "SlackAdapterError";
  }
}

/**
 * The contract Mitable's scan code depends on. Methods can throw
 * SlackAdapterError; everything else is treated as a hard error and bubbles up.
 */
export interface SlackClient {
  /**
   * Cheap auth check. Returns true if the underlying MCP can reach Slack;
   * false if auth is expired / missing and the user needs to re-authenticate.
   * Per §1.5: "Never fail silently."
   */
  authPreflight(): Promise<boolean>;

  /**
   * Phase A. Returns whether new messages exist since `oldest_ts` without
   * paginating all of them.
   */
  probe(opts: { channel_id: string; oldest_ts: string }): Promise<ProbeResult>;

  /**
   * Phase B (channel). Returns parent messages since `oldest_ts`, oldest first,
   * up to `limit`. Replies are not included — caller fetches per-thread via readThread.
   */
  readChannel(opts: {
    channel_id: string;
    oldest_ts: string;
    limit: number;
  }): Promise<SlackMessage[]>;

  /**
   * Phase B (thread). Returns parent + all replies since `oldest_reply_ts`.
   */
  readThread(opts: {
    channel_id: string;
    thread_ts: string;
    oldest_reply_ts: string;
  }): Promise<SlackThread>;
}

// ---------- stub ----------

/**
 * No-op adapter. Always authenticates, always reports "no new messages."
 * Use it everywhere the scan path needs to run but real Slack data is not
 * available (smoke tests, dry-runs before the real adapter is wired).
 */
export class StubSlackClient implements SlackClient {
  async authPreflight(): Promise<boolean> {
    return true;
  }
  async probe(): Promise<ProbeResult> {
    return { has_new: false, newest_ts: "" };
  }
  async readChannel(): Promise<SlackMessage[]> {
    return [];
  }
  async readThread(opts: {
    channel_id: string;
    thread_ts: string;
    oldest_reply_ts: string;
  }): Promise<SlackThread> {
    return { channel_id: opts.channel_id, thread_ts: opts.thread_ts, messages: [] };
  }
}

/**
 * Convenience adapter for tests: feed in canned messages keyed by channel.
 * Lets the scan code be exercised against synthetic data without a real MCP.
 */
export class CannedSlackClient implements SlackClient {
  constructor(
    private readonly data: {
      channels: Record<string, SlackMessage[]>;
      threads?: Record<string, SlackMessage[]>;   // key: "<channel>:<thread_ts>"
      auth_ok?: boolean;
    },
  ) {}

  async authPreflight(): Promise<boolean> {
    return this.data.auth_ok ?? true;
  }
  async probe(opts: { channel_id: string; oldest_ts: string }): Promise<ProbeResult> {
    const msgs = this.newer(this.data.channels[opts.channel_id] ?? [], opts.oldest_ts);
    if (msgs.length === 0) return { has_new: false, newest_ts: "" };
    return { has_new: true, newest_ts: msgs[msgs.length - 1]!.ts };
  }
  async readChannel(opts: {
    channel_id: string;
    oldest_ts: string;
    limit: number;
  }): Promise<SlackMessage[]> {
    return this.newer(this.data.channels[opts.channel_id] ?? [], opts.oldest_ts).slice(
      0,
      opts.limit,
    );
  }
  async readThread(opts: {
    channel_id: string;
    thread_ts: string;
    oldest_reply_ts: string;
  }): Promise<SlackThread> {
    const key = `${opts.channel_id}:${opts.thread_ts}`;
    const all = this.data.threads?.[key] ?? [];
    return {
      channel_id: opts.channel_id,
      thread_ts: opts.thread_ts,
      messages: this.newer(all, opts.oldest_reply_ts),
    };
  }
  private newer(msgs: SlackMessage[], oldest_ts: string): SlackMessage[] {
    const cutoff = parseFloat(oldest_ts);
    if (!Number.isFinite(cutoff)) return [...msgs];
    return msgs.filter((m) => parseFloat(m.ts) > cutoff);
  }
}
