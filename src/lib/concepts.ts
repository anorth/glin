import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const CONCEPT_TREES = ["sources", "wiki"] as const;
export const RESERVED_MD = new Set(["index.md", "log.md"]);

export function isConceptMarkdown(name: string): boolean {
  return name.endsWith(".md") && !RESERVED_MD.has(name);
}

/** Posix paths relative to the KB root, e.g. `wiki/methodology/effect-sizes.md`. */
export async function listConceptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const tree of CONCEPT_TREES) {
    const abs = join(root, tree);
    if (!existsSync(abs)) {
      continue;
    }
    await walkDir(abs, tree, files);
  }
  return files;
}

export function stringField(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripMd(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

async function walkDir(absDir: string, relDir: string, files: string[]): Promise<void> {
  const dirents = await readdir(absDir, { withFileTypes: true });
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) {
      continue;
    }
    if (dirent.isDirectory()) {
      await walkDir(join(absDir, dirent.name), posixJoin(relDir, dirent.name), files);
    } else if (dirent.isFile() && isConceptMarkdown(dirent.name)) {
      files.push(posixJoin(relDir, dirent.name));
    }
  }
}
