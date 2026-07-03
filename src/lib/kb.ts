import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Resolve the KB root from an optional --base-dir value (defaults to cwd). */
export function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(process.cwd(), baseDir) : process.cwd();
}

/** Ensure the base directory looks like a glin knowledge base (has raw/). */
export function requireBaseDir(baseDir?: string): string {
  const root = resolveBaseDir(baseDir);
  const rawDir = join(root, "raw");
  if (!existsSync(rawDir)) {
    throw new Error(
      `Not a knowledge base: raw/ directory not found in ${root}. Pass --base-dir or run from the KB root.`,
    );
  }
  return root;
}
