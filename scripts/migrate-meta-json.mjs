#!/usr/bin/env node
/**
 * One-shot: rewrite meta.json files under raw/ from snake_case to camelCase.
 *
 *   node scripts/migrate-meta-json.mjs <kb-root>
 *
 * Idempotent. Does not touch YAML frontmatter.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RENAME = {
  source_url: "sourceUrl",
  final_url: "finalUrl",
  content_type: "contentType",
  canonical_url: "canonicalUrl",
  linked_media: "linkedMedia",
  scripts_stripped: "scriptsStripped",
  styles_stripped: "stylesStripped",
  archive_path: "archivePath",
};

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/migrate-meta-json.mjs <kb-root>");
  process.exit(1);
}

const rawDir = join(root, "raw");
if (!existsSync(rawDir)) {
  console.error(`no raw/ directory at ${rawDir}`);
  process.exit(1);
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.name === "meta.json") {
      yield path;
    }
  }
}

let scanned = 0;
let changed = 0;
for await (const path of walk(rawDir)) {
  scanned += 1;
  const meta = JSON.parse(await readFile(path, "utf8"));
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error(`not a JSON object: ${path}`);
  }
  let dirty = false;
  for (const [from, to] of Object.entries(RENAME)) {
    if (!Object.hasOwn(meta, from)) {
      continue;
    }
    if (!Object.hasOwn(meta, to)) {
      meta[to] = meta[from];
    }
    delete meta[from];
    dirty = true;
  }
  // archivePath is stdout-only; drop it if an old file recorded it.
  if (Object.hasOwn(meta, "archivePath")) {
    delete meta.archivePath;
    dirty = true;
  }
  if (!dirty) {
    continue;
  }
  await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(path);
  changed += 1;
}

console.error(`migrated ${changed} of ${scanned} meta.json files`);
