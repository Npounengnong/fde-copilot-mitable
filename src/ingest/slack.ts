/**
 * Two-phase Slack scan.
 *
 * Spec: docs/07-scan-and-store.md §1.2.
 *
 * Phase A: cheap probe per active channel — call slack search-tier endpoint
 *   to check if anything is new. Channels with no new content are skipped
 *   without touching channel-history tier.
 *
 * Phase B: for channels that passed A, fetch up to N parent messages, then
 *   for each parent that's worth a deep read (reply_count > 3 or FDE
 *   participated) fetch the thread. Each thread is classified independently.
 *
 * Watermarks advance only after a successful read of that channel/thread.
 * Per §1.4: "Reruns are idempotent — a channel scanned twice in the same
 * window produces no duplicates because the second pass sees no new messages."
 */
import { activeChannels, advanceChannelWatermark, advanceThreadWatermark, getChannelWatermark, getThreadWatermark } from "../store/channel-map.js";
import type { SlackClient, SlackMessage } from "./slack-adapter.js";
import { SlackAdapterError } from "./slack-adapter.js";
import { classifyThread } from "./classify-thread.js";

const CHANNEL_READ_LIMIT = 200;
const THREAD_DEEP_READ_REPLY_THRESHOLD = 3;

export interface SweepOptions {
  client: SlackClient;
  /** If true, do not classify or write anything. Useful for shape validation. */
  dry_run?: boolean;
  /** Only sweep channels mapped to this customer. */
  customer_id?: string;
  /** Don't spend more than this on per-thread LLM calls. v1: rely on per-thread timeouts. */
  thread_classify_timeout_ms?: number;
}

export interface SweepResult {
  channels_examined: number;
  channels_with_new: number;
  threads_examined: number;
  threads_deep_read: number;
  extractions_written: number;
  extractions_rejected: number;
  auth_ok: boolean;
  errors: Array<{ channel_id: string; kind: string; message: string }>;
  dry_run: boolean;
}

export async function sweepSlack(opts: SweepOptions): Promise<SweepResult> {
  const result: SweepResult = {
    channels_examined: 0,
    channels_with_new: 0,
    threads_examined: 0,
    threads_deep_read: 0,
    extractions_written: 0,
    extractions_rejected: 0,
    auth_ok: true,
    errors: [],
    dry_run: opts.dry_run ?? false,
  };

  const authOk = await opts.client.authPreflight();
  result.auth_ok = authOk;
  if (!authOk) {
    return result; // §1.5 — surface preflight failure; do not continue.
  }

  const channels = activeChannels().filter(
    (c) => !opts.customer_id || c.customer_id === opts.customer_id,
  );

  for (const ch of channels) {
    result.channels_examined++;
    const wm = getChannelWatermark(ch.channel_id);

    let probe;
    try {
      probe = await opts.client.probe({ channel_id: ch.channel_id, oldest_ts: wm.channel_watermark });
    } catch (err) {
      result.errors.push(adapterErrToReport(ch.channel_id, err));
      continue;
    }
    if (!probe.has_new) continue;
    result.channels_with_new++;

    // Phase B (channel): fetch parents since watermark.
    let parents: SlackMessage[];
    try {
      parents = await opts.client.readChannel({
        channel_id: ch.channel_id,
        oldest_ts: wm.channel_watermark,
        limit: CHANNEL_READ_LIMIT,
      });
    } catch (err) {
      result.errors.push(adapterErrToReport(ch.channel_id, err));
      continue;
    }

    // Track the newest ts we successfully *read*. Watermark advances only after
    // all per-thread work below either succeeds or is intentionally skipped.
    let newestSeen = wm.channel_watermark;

    for (const parent of parents) {
      result.threads_examined++;
      newestSeen = maxTs(newestSeen, parent.ts);

      // Decide whether this thread is worth a deep read.
      const replyCount = parent.reply_count ?? 0;
      const deepRead = replyCount > THREAD_DEEP_READ_REPLY_THRESHOLD;
      if (!deepRead) {
        // For v1, only deep-read threaded discussions. Single messages are too noisy
        // to extract usefully without the parent classifier picking up false positives.
        // (FDE-participation heuristic can be added once we have an actor model.)
        continue;
      }

      const threadWm = getThreadWatermark(ch.channel_id, parent.ts);
      let thread;
      try {
        thread = await opts.client.readThread({
          channel_id: ch.channel_id,
          thread_ts: parent.ts,
          oldest_reply_ts: threadWm.thread_watermark,
        });
      } catch (err) {
        result.errors.push(adapterErrToReport(ch.channel_id, err));
        continue;
      }

      result.threads_deep_read++;
      const newestReplyTs = thread.messages[thread.messages.length - 1]?.ts ?? threadWm.thread_watermark;

      if (!opts.dry_run) {
        try {
          const classified = await classifyThread({
            customer_id: ch.customer_id,
            thread: { channel_id: ch.channel_id, thread_ts: parent.ts, messages: thread.messages.length > 0 ? thread.messages : [parent] },
            timeout_ms: opts.thread_classify_timeout_ms,
          });
          result.extractions_written += classified.extractions_written;
          result.extractions_rejected += classified.extractions_rejected;
        } catch (err) {
          result.errors.push({
            channel_id: ch.channel_id,
            kind: "classify_failed",
            message: err instanceof Error ? err.message : String(err),
          });
          // Do not advance the thread watermark on classify failure — we want to retry.
          continue;
        }
      }

      // Advance the thread watermark only after a successful classify (or dry-run pass).
      advanceThreadWatermark(ch.channel_id, parent.ts, newestReplyTs);
    }

    // Advance the channel watermark to the newest parent we read.
    if (newestSeen && newestSeen !== wm.channel_watermark) {
      advanceChannelWatermark(ch.channel_id, newestSeen);
    }
  }

  return result;
}

function adapterErrToReport(channel_id: string, err: unknown) {
  if (err instanceof SlackAdapterError) {
    return { channel_id, kind: err.detail.kind, message: err.detail.message };
  }
  return {
    channel_id,
    kind: "other",
    message: err instanceof Error ? err.message : String(err),
  };
}

function maxTs(a: string, b: string): string {
  const fa = parseFloat(a);
  const fb = parseFloat(b);
  if (!Number.isFinite(fa)) return b;
  if (!Number.isFinite(fb)) return a;
  return fa >= fb ? a : b;
}
