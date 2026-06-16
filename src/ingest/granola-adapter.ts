/**
 * Granola adapter — interface + stub + canned.
 *
 * Spec: docs/07-scan-and-store.md §1.3 (two-phase Granola), §1.5 (auth preflight).
 *
 * Granola is connected via `claude mcp add granola --transport http
 * https://mcp.granola.ai/mcp`. The Granola MCP's exact tool names are not
 * pinned here — this file is the seam. The real adapter that proxies to
 * mcp__granola__* lands when a real account is wired up.
 *
 * v1 ships only the stub + canned. The stub returns "no new notes" so the
 * scan path is exercisable without a real Granola connection.
 */

export interface GranolaNote {
  /** Granola's stable meeting/note identifier. */
  meeting_id: string;
  /** Note "updated_at" in unix ms — used as the watermark. */
  updated_ts: number;
  title: string;
  /** Full note body. Markdown or plaintext, classifier handles either. */
  body: string;
  /** Permalink back to the note in Granola, if available. */
  permalink?: string;
  /** Attendees, if available — useful for downstream customer-mapping heuristics. */
  attendees?: string[];
}

export interface GranolaProbeResult {
  has_new: boolean;
  newest_ts: number;
}

export type GranolaAdapterErrorKind =
  | { kind: "auth_expired"; message: string }
  | { kind: "rate_limited"; retry_after_seconds: number; message: string }
  | { kind: "other"; message: string };

export class GranolaAdapterError extends Error {
  constructor(public detail: GranolaAdapterErrorKind) {
    super(detail.message);
    this.name = "GranolaAdapterError";
  }
}

/**
 * The contract Mitable's scan code depends on.
 */
export interface GranolaClient {
  authPreflight(): Promise<boolean>;

  probe(opts: { meeting_id: string; oldest_ts: number }): Promise<GranolaProbeResult>;

  /**
   * Return the latest note for this meeting if its updated_ts > oldest_ts.
   * Otherwise null. v1 treats one note per meeting — multiple revisions of
   * the same meeting use the latest body and re-classify (dedup keeps
   * downstream sane).
   */
  fetchNote(opts: { meeting_id: string; oldest_ts: number }): Promise<GranolaNote | null>;
}

// ---------- stub ----------

export class StubGranolaClient implements GranolaClient {
  async authPreflight(): Promise<boolean> {
    return true;
  }
  async probe(): Promise<GranolaProbeResult> {
    return { has_new: false, newest_ts: 0 };
  }
  async fetchNote(): Promise<GranolaNote | null> {
    return null;
  }
}

/**
 * Test adapter — feed in canned notes keyed by meeting_id.
 */
export class CannedGranolaClient implements GranolaClient {
  constructor(
    private readonly data: {
      notes: Record<string, GranolaNote>;
      auth_ok?: boolean;
    },
  ) {}

  async authPreflight(): Promise<boolean> {
    return this.data.auth_ok ?? true;
  }
  async probe(opts: { meeting_id: string; oldest_ts: number }): Promise<GranolaProbeResult> {
    const note = this.data.notes[opts.meeting_id];
    if (!note || note.updated_ts <= opts.oldest_ts) {
      return { has_new: false, newest_ts: 0 };
    }
    return { has_new: true, newest_ts: note.updated_ts };
  }
  async fetchNote(opts: { meeting_id: string; oldest_ts: number }): Promise<GranolaNote | null> {
    const note = this.data.notes[opts.meeting_id];
    if (!note || note.updated_ts <= opts.oldest_ts) return null;
    return note;
  }
}
