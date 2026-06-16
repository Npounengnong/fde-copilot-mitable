/**
 * In-process scheduler.
 *
 * Spec: docs/06-interaction-model.md §2, docs/10-non-goals.md.
 *
 * Runs inside the MCP server process. Every `interval_ms` (default 5 min) it:
 *   1. Runs a Slack sweep against every active channel
 *   2. Drains the classification queue using the channel_map for customer hints
 *
 * No native plugin cron — when Claude Code isn't running, this scheduler
 * doesn't run. That tradeoff is in 10-non-goals.md.
 *
 * v1 ships disabled-by-default: the user calls `sweep_now` manually until
 * a real SlackClient is wired (so we don't burn cycles in a stub loop).
 * Enable via MITABLE_SCHEDULER=1 env var.
 */
import { sweepSlack, type SweepResult } from "./slack.js";
import { StubSlackClient, type SlackClient } from "./slack-adapter.js";
import { sweepGranola, type GranolaSweepResult } from "./granola.js";
import { StubGranolaClient, type GranolaClient } from "./granola-adapter.js";

export interface SchedulerHandle {
  stop: () => void;
}

export interface CombinedSweepResult {
  slack: SweepResult;
  granola: GranolaSweepResult;
}

export interface SchedulerOpts {
  slack_client?: SlackClient;
  granola_client?: GranolaClient;
  interval_ms?: number;
  on_tick?: (result: CombinedSweepResult) => void;
  on_error?: (err: unknown) => void;
}

export function startScheduler(opts: SchedulerOpts = {}): SchedulerHandle {
  const slackClient = opts.slack_client ?? new StubSlackClient();
  const granolaClient = opts.granola_client ?? new StubGranolaClient();
  const intervalMs = opts.interval_ms ?? 5 * 60 * 1000;

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running) return; // skip overlap
    running = true;
    try {
      const slack = await sweepSlack({ client: slackClient });
      const granola = await sweepGranola({ client: granolaClient });
      opts.on_tick?.({ slack, granola });
    } catch (err) {
      opts.on_error?.(err);
    } finally {
      running = false;
    }
  };

  // First tick after one interval, not immediately — lets the MCP server
  // finish startup and avoid stampeding on cold start.
  timer = setInterval(tick, intervalMs);

  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export function schedulerEnabled(): boolean {
  return process.env.MITABLE_SCHEDULER === "1";
}
