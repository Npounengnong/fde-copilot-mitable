/**
 * Two-phase Granola scan.
 *
 * Spec: docs/07-scan-and-store.md §1.3.
 *
 * Phase A: probe per active meeting to see if the note has changed since
 *   the last watermark. No-op when notes are stable.
 * Phase B: fetch the updated note body and classify it. Watermark advances
 *   only after a successful classify.
 *
 * Per §1.4 the advance-only rule still applies: re-running over the same
 * window finds nothing new.
 */
import {
  activeMeetings,
  advanceMeetingWatermark,
  getMeetingWatermark,
} from "../store/granola-map.js";
import type { GranolaClient } from "./granola-adapter.js";
import { GranolaAdapterError } from "./granola-adapter.js";
import { classifyNote } from "./classify-note.js";

export interface GranolaSweepOptions {
  client: GranolaClient;
  dry_run?: boolean;
  customer_id?: string;
  note_classify_timeout_ms?: number;
}

export interface GranolaSweepResult {
  meetings_examined: number;
  meetings_with_new: number;
  notes_classified: number;
  extractions_written: number;
  extractions_rejected: number;
  auth_ok: boolean;
  errors: Array<{ meeting_id: string; kind: string; message: string }>;
  dry_run: boolean;
}

export async function sweepGranola(opts: GranolaSweepOptions): Promise<GranolaSweepResult> {
  const result: GranolaSweepResult = {
    meetings_examined: 0,
    meetings_with_new: 0,
    notes_classified: 0,
    extractions_written: 0,
    extractions_rejected: 0,
    auth_ok: true,
    errors: [],
    dry_run: opts.dry_run ?? false,
  };

  const authOk = await opts.client.authPreflight();
  result.auth_ok = authOk;
  if (!authOk) return result;

  const meetings = activeMeetings().filter(
    (m) => !opts.customer_id || m.customer_id === opts.customer_id,
  );

  for (const m of meetings) {
    result.meetings_examined++;
    const wm = getMeetingWatermark(m.meeting_id);

    let probe;
    try {
      probe = await opts.client.probe({
        meeting_id: m.meeting_id,
        oldest_ts: wm.watermark_ts,
      });
    } catch (err) {
      result.errors.push(adapterErrToReport(m.meeting_id, err));
      continue;
    }
    if (!probe.has_new) continue;
    result.meetings_with_new++;

    let note;
    try {
      note = await opts.client.fetchNote({
        meeting_id: m.meeting_id,
        oldest_ts: wm.watermark_ts,
      });
    } catch (err) {
      result.errors.push(adapterErrToReport(m.meeting_id, err));
      continue;
    }
    if (!note) continue;

    if (!opts.dry_run) {
      try {
        const classified = await classifyNote({
          customer_id: m.customer_id,
          note,
          timeout_ms: opts.note_classify_timeout_ms,
        });
        result.notes_classified++;
        result.extractions_written += classified.extractions_written;
        result.extractions_rejected += classified.extractions_rejected;
      } catch (err) {
        result.errors.push({
          meeting_id: m.meeting_id,
          kind: "classify_failed",
          message: err instanceof Error ? err.message : String(err),
        });
        continue; // do NOT advance watermark on classify failure
      }
    }

    advanceMeetingWatermark(m.meeting_id, note.updated_ts);
  }

  return result;
}

function adapterErrToReport(meeting_id: string, err: unknown) {
  if (err instanceof GranolaAdapterError) {
    return { meeting_id, kind: err.detail.kind, message: err.detail.message };
  }
  return {
    meeting_id,
    kind: "other",
    message: err instanceof Error ? err.message : String(err),
  };
}
