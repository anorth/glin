import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Truncated sha256 basename, optionally with extension (e.g. `abcd….png`). */
export function contentHashBasename(
  body: Buffer,
  extension: string | null | undefined,
): string {
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return extension ? `${hash}.${extension}` : hash;
}

/** Picks a hash basename, reusing an existing file when content matches or suffixing on collision. */
export async function resolveHashFilename(
  assetDir: string,
  basename: string,
  body: Buffer,
): Promise<string> {
  let candidate = basename;
  for (let suffix = 2; ; suffix++) {
    const localPath = join(assetDir, candidate);
    if (!existsSync(localPath)) {
      return candidate;
    }
    const existing = await readFile(localPath);
    if (existing.equals(body)) {
      return candidate;
    }
    candidate = suffixHashFilename(basename, suffix);
  }
}

/** Inserts -2, -3, … before the extension when a truncated hash collides. */
export function suffixHashFilename(basename: string, suffix: number): string {
  const dot = basename.lastIndexOf(".");
  if (dot > 0) {
    return `${basename.slice(0, dot)}-${suffix}${basename.slice(dot)}`;
  }
  return `${basename}-${suffix}`;
}
