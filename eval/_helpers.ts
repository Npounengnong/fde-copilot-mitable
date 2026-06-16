/**
 * Shared helpers for the eval suite.
 *
 * Each test file should call `useEphemeralMitableHome()` in a `before` hook
 * to point the process at a fresh, isolated $MITABLE_HOME. That way tests
 * never touch the real `~/.mitable` and never see state from another test.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";

import { closeDb } from "../src/store/schema.js";

export function freshMitableHome(label: string): string {
  const dir = join(tmpdir(), `mitable-eval-${label}-${ulid()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function useEphemeralMitableHome(label: string): { dir: string; cleanup: () => void } {
  const dir = freshMitableHome(label);
  process.env.MITABLE_HOME = dir;
  return {
    dir,
    cleanup: () => {
      closeDb();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort — tmp will eventually be reaped anyway.
      }
    },
  };
}
