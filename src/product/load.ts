/**
 * Product Manual loader.
 *
 * Spec: docs/04-product-manual.md, docs/08-context-assembly.md §4.
 *
 * The Product Manual is canonical product knowledge — manually authored,
 * not extracted. Lives under $MITABLE_HOME/product/. v1 of the loader
 * just lists what's there so the command center can show it; brief
 * integration is a no-op until building blocks are populated.
 *
 * Directory layout (from docs/04):
 *   product/
 *     README.md
 *     building-blocks/
 *       configuration-primitives/
 *       integrations/
 *       mcp-tools/
 *     pages/
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mitableHome } from "../store/schema.js";

export interface ProductEntry {
  kind: "building-block" | "page";
  category?: string;            // for building blocks: e.g. "integrations"
  title: string;
  path: string;
  body_excerpt: string;
}

const MAX_BODY_CHARS_PER_ENTRY = 600;

export function productRoot(): string {
  return join(mitableHome(), "product");
}

export function loadAllProductEntries(): ProductEntry[] {
  const root = productRoot();
  if (!existsSync(root)) return [];

  const entries: ProductEntry[] = [];

  // Building blocks
  const blocksRoot = join(root, "building-blocks");
  if (existsSync(blocksRoot)) {
    let categories: string[];
    try {
      categories = readdirSync(blocksRoot).filter((c) =>
        safeIsDir(join(blocksRoot, c)),
      );
    } catch {
      categories = [];
    }
    for (const cat of categories) {
      const catPath = join(blocksRoot, cat);
      for (const f of safeListMd(catPath)) {
        entries.push(makeEntry("building-block", cat, f));
      }
    }
  }

  // Pages
  const pagesRoot = join(root, "pages");
  if (existsSync(pagesRoot)) {
    for (const f of safeListMd(pagesRoot)) {
      entries.push(makeEntry("page", undefined, f));
    }
  }

  return entries;
}

/**
 * v1 brief integration: no-op unless content exists. Returns entries that
 * should be referenced from the brief — currently means "everything,"
 * because there's no ranking heuristic yet.
 */
export function loadProductForBrief(): ProductEntry[] {
  return loadAllProductEntries();
}

function makeEntry(
  kind: ProductEntry["kind"],
  category: string | undefined,
  filePath: string,
): ProductEntry {
  let body = "";
  try {
    body = readFileSync(filePath, "utf8");
  } catch {
    body = "";
  }
  return {
    kind,
    category,
    title: stripExt(basename(filePath)),
    path: filePath,
    body_excerpt: truncate(body.trim(), MAX_BODY_CHARS_PER_ENTRY),
  };
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeListMd(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function stripExt(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 1)}…`;
}
