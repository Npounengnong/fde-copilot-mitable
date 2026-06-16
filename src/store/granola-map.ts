/**
 * Granola meeting-to-customer map + per-meeting watermarks.
 *
 * Spec: docs/07-scan-and-store.md §1.1, §1.3, §1.4; docs/09-data-model.md.
 *
 * Mirror of channel-map.ts but keyed on Granola meeting IDs (or calendar
 * event IDs — same shape, different `type`). Stored as JSON under
 * $MITABLE_HOME alongside channel-map.json for the same reasons (small,
 * easy to inspect, easy to back up).
 *
 *   granola-map.json   { customer_id, title, type, active } keyed by meeting_id
 *   granola-watermarks.json   { watermark_ts, last_sweep } keyed by meeting_id
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mitableHome } from "./schema.js";

export type GranolaMappingType = "meeting" | "calendar_event";

export interface GranolaMapping {
  customer_id: string;
  title: string;
  type: GranolaMappingType;
  active: boolean;
}

export interface MeetingWatermark {
  /** Granola's "updated_at" or equivalent for the last note seen. 0 = never swept. */
  watermark_ts: number;
  last_sweep: number;
}

type WatermarksFile = { meetings: Record<string, MeetingWatermark> };
const EMPTY: WatermarksFile = { meetings: {} };

function mapPath(): string {
  return join(mitableHome(), "granola-map.json");
}

function wmPath(): string {
  return join(mitableHome(), "granola-watermarks.json");
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

// ---------- meeting map ----------

export function loadGranolaMap(): Record<string, GranolaMapping> {
  return readJson(mapPath(), {} as Record<string, GranolaMapping>);
}

export function saveGranolaMap(map: Record<string, GranolaMapping>): void {
  writeAtomic(mapPath(), map);
}

export function addMeeting(input: {
  meeting_id: string;
  title: string;
  customer_id: string;
  type?: GranolaMappingType;
}): void {
  const map = loadGranolaMap();
  map[input.meeting_id] = {
    customer_id: input.customer_id,
    title: input.title,
    type: input.type ?? "meeting",
    active: true,
  };
  saveGranolaMap(map);
}

export function pauseMeeting(meeting_id: string): boolean {
  const map = loadGranolaMap();
  const entry = map[meeting_id];
  if (!entry) return false;
  entry.active = false;
  saveGranolaMap(map);
  return true;
}

export function resumeMeeting(meeting_id: string): boolean {
  const map = loadGranolaMap();
  const entry = map[meeting_id];
  if (!entry) return false;
  entry.active = true;
  saveGranolaMap(map);
  return true;
}

export function removeMeeting(meeting_id: string): boolean {
  const map = loadGranolaMap();
  if (!(meeting_id in map)) return false;
  delete map[meeting_id];
  saveGranolaMap(map);
  return true;
}

export function activeMeetings(): Array<GranolaMapping & { meeting_id: string }> {
  const map = loadGranolaMap();
  return Object.entries(map)
    .filter(([, v]) => v.active)
    .map(([meeting_id, v]) => ({ meeting_id, ...v }));
}

export function listMeetings(): Array<GranolaMapping & { meeting_id: string }> {
  const map = loadGranolaMap();
  return Object.entries(map).map(([meeting_id, v]) => ({ meeting_id, ...v }));
}

// ---------- watermarks ----------

function loadWatermarks(): WatermarksFile {
  return readJson(wmPath(), { ...EMPTY });
}

function saveWatermarks(w: WatermarksFile): void {
  writeAtomic(wmPath(), w);
}

export function getMeetingWatermark(meeting_id: string): MeetingWatermark {
  return loadWatermarks().meetings[meeting_id] ?? { watermark_ts: 0, last_sweep: 0 };
}

/** Most-recent last_sweep timestamp across all meetings, for the status header. */
export function lastMeetingSweep(): number | null {
  const all = loadWatermarks().meetings;
  let max = 0;
  for (const m of Object.values(all)) if (m.last_sweep > max) max = m.last_sweep;
  return max === 0 ? null : max;
}

export function advanceMeetingWatermark(meeting_id: string, newest_ts: number): void {
  const all = loadWatermarks();
  const existing = all.meetings[meeting_id] ?? { watermark_ts: 0, last_sweep: 0 };
  all.meetings[meeting_id] = {
    watermark_ts: Math.max(existing.watermark_ts, newest_ts),
    last_sweep: Date.now(),
  };
  saveWatermarks(all);
}
