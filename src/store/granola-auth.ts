/**
 * Granola API key storage.
 *
 * The user generates a static API key in the Granola app
 * (Settings -> Connectors -> API Keys) and pastes it into Mitable.
 * Keys are prefixed with "grn_" and do not expire.
 *
 * Stored in $MITABLE_HOME/granola-auth.json alongside other config files.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { mitableHome } from "./schema.js";

export interface GranolaAuth {
  token: string;
  created_at: number;
}

const AUTH_PATH = (): string => join(mitableHome(), "granola-auth.json");

export function loadGranolaAuth(): GranolaAuth | null {
  const path = AUTH_PATH();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<GranolaAuth>;
    if (typeof raw.token === "string" && raw.token.startsWith("grn_")) {
      return { token: raw.token, created_at: typeof raw.created_at === "number" ? raw.created_at : 0 };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveGranolaAuth(token: string): void {
  const path = AUTH_PATH();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ token, created_at: Date.now() }, null, 2));
}

export function hasGranolaAuth(): boolean {
  return loadGranolaAuth() !== null;
}
