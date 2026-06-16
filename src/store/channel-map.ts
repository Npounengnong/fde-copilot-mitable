/**
 * Channel-to-customer map + Slack watermarks.
 *
 * Spec: docs/07-scan-and-store.md §1.1, §1.4; docs/09-data-model.md.
 *
 * Two JSON files under $MITABLE_HOME because they're small, infrequently
 * written, and easy to inspect by hand:
 *
 *   channel-map.json   { customer_id, channel_name, active } keyed by channel_id
 *   watermarks.json    { channel_watermark, last_sweep } keyed by channel_id or "<ch>:<thread_ts>"
 *
 * Both files are read/written via this module — never directly elsewhere.
 * Writes go through a temp-file-then-rename pattern so a partial write never
 * leaves a corrupted file.
 */
import { readFileSync, renameSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { mitableHome } from "./schema.js";

export interface ChannelMapping {
  customer_id: string;
  channel_name: string;        // e.g. "#carver-support"
  active: boolean;
}

export interface ChannelWatermark {
  /** Slack's newest_ts of the last channel-level message seen. Empty string = never swept. */
  channel_watermark: string;
  /** Unix ms of the last sweep completion. 0 = never swept. */
  last_sweep: number;
}

export interface ThreadWatermark {
  /** Newest reply_ts seen for this thread. */
  thread_watermark: string;
  last_sweep: number;
}

type WatermarksFile = {
  channels: Record<string, ChannelWatermark>;
  threads: Record<string, ThreadWatermark>;   // keyed by `${channel_id}:${thread_ts}`
};

const EMPTY_WATERMARKS: WatermarksFile = { channels: {}, threads: {} };

function channelMapPath(): string {
  return join(mitableHome(), "channel-map.json");
}

function watermarksPath(): string {
  return join(mitableHome(), "watermarks.json");
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // Corrupt file — treat as empty rather than crashing the whole sweep.
    return fallback;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

// ---------- channel map ----------

export function loadChannelMap(): Record<string, ChannelMapping> {
  return readJson(channelMapPath(), {} as Record<string, ChannelMapping>);
}

export function saveChannelMap(map: Record<string, ChannelMapping>): void {
  writeJsonAtomic(channelMapPath(), map);
}

export function addChannel(input: {
  channel_id: string;
  channel_name: string;
  customer_id: string;
}): void {
  const map = loadChannelMap();
  map[input.channel_id] = {
    customer_id: input.customer_id,
    channel_name: input.channel_name,
    active: true,
  };
  saveChannelMap(map);
}

export function pauseChannel(channel_id: string): boolean {
  const map = loadChannelMap();
  const entry = map[channel_id];
  if (!entry) return false;
  entry.active = false;
  saveChannelMap(map);
  return true;
}

export function resumeChannel(channel_id: string): boolean {
  const map = loadChannelMap();
  const entry = map[channel_id];
  if (!entry) return false;
  entry.active = true;
  saveChannelMap(map);
  return true;
}

export function removeChannel(channel_id: string): boolean {
  const map = loadChannelMap();
  if (!(channel_id in map)) return false;
  delete map[channel_id];
  saveChannelMap(map);
  return true;
}

export function activeChannels(): Array<ChannelMapping & { channel_id: string }> {
  const map = loadChannelMap();
  return Object.entries(map)
    .filter(([, v]) => v.active)
    .map(([channel_id, v]) => ({ channel_id, ...v }));
}

export function listChannels(): Array<ChannelMapping & { channel_id: string }> {
  const map = loadChannelMap();
  return Object.entries(map).map(([channel_id, v]) => ({ channel_id, ...v }));
}

// ---------- watermarks ----------

function loadWatermarks(): WatermarksFile {
  return readJson(watermarksPath(), { ...EMPTY_WATERMARKS });
}

function saveWatermarks(w: WatermarksFile): void {
  writeJsonAtomic(watermarksPath(), w);
}

export function getChannelWatermark(channel_id: string): ChannelWatermark {
  return loadWatermarks().channels[channel_id] ?? { channel_watermark: "", last_sweep: 0 };
}

export function getThreadWatermark(channel_id: string, thread_ts: string): ThreadWatermark {
  const key = `${channel_id}:${thread_ts}`;
  return loadWatermarks().threads[key] ?? { thread_watermark: "", last_sweep: 0 };
}

/**
 * Advance-only update. If the new watermark is older (Slack ts is a string
 * but parses as a float), the existing value is kept.
 */
export function advanceChannelWatermark(channel_id: string, newest_ts: string): void {
  const all = loadWatermarks();
  const existing = all.channels[channel_id] ?? { channel_watermark: "", last_sweep: 0 };
  const next = maxTs(existing.channel_watermark, newest_ts);
  all.channels[channel_id] = { channel_watermark: next, last_sweep: Date.now() };
  saveWatermarks(all);
}

export function advanceThreadWatermark(
  channel_id: string,
  thread_ts: string,
  newest_reply_ts: string,
): void {
  const all = loadWatermarks();
  const key = `${channel_id}:${thread_ts}`;
  const existing = all.threads[key] ?? { thread_watermark: "", last_sweep: 0 };
  const next = maxTs(existing.thread_watermark, newest_reply_ts);
  all.threads[key] = { thread_watermark: next, last_sweep: Date.now() };
  saveWatermarks(all);
}

function maxTs(a: string, b: string): string {
  // Slack ts: "1718123456.000100". Float comparison is correct here.
  const fa = parseFloat(a);
  const fb = parseFloat(b);
  if (!Number.isFinite(fa)) return b;
  if (!Number.isFinite(fb)) return a;
  return fa >= fb ? a : b;
}
