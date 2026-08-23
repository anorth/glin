import { existsSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { requireBaseDir } from "./kb.js";

const CONCEPT_TREES = ["sources", "wiki"] as const;
const RESERVED_MD = new Set(["index.md", "log.md"]);

export type ReindexResult = {
  written: string[];
};

export type ReindexOptions = {
  baseDir?: string;
  log?: (message: string) => void;
};

type IndexEntry = {
  title: string;
  url: string;
  description: string;
};

/** Regenerates index.md files for sources/, wiki/, and the KB root. */
export async function reindex(options: ReindexOptions = {}): Promise<ReindexResult> {
  const root = requireBaseDir(options.baseDir);
  const log = options.log ?? (() => {});

  const result = await reindexDir(root, "", { isRoot: true });
  result.written.sort((a, b) => a.localeCompare(b));
  log(`wrote ${result.written.length} index files`);
  return { written: result.written };
}

async function reindexDir(
  absDir: string,
  relDir: string,
  opts: { isRoot: boolean },
): Promise<{ written: string[]; lead: string | null }> {
  const dirents = await readdir(absDir, { withFileTypes: true });
  const written: string[] = [];
  const entries: IndexEntry[] = [];

  if (opts.isRoot) {
    for (const name of CONCEPT_TREES) {
      const child = dirents.find((d) => d.name === name && d.isDirectory());
      if (!child) {
        continue;
      }
      const nested = await reindexDir(join(absDir, name), name, { isRoot: false });
      written.push(...nested.written);
      entries.push({
        title: name,
        url: `${name}/`,
        description: nested.lead ?? "",
      });
    }
  } else {
    const subdirs = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const dir of subdirs) {
      const nested = await reindexDir(
        join(absDir, dir.name),
        posixJoin(relDir, dir.name),
        { isRoot: false },
      );
      written.push(...nested.written);
      entries.push({
        title: dir.name,
        url: `${dir.name}/`,
        description: nested.lead ?? "",
      });
    }

    const files = dirents
      .filter((d) => d.isFile() && d.name.endsWith(".md") && !RESERVED_MD.has(d.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const file of files) {
      const text = await readFile(join(absDir, file.name), "utf8");
      const { data } = parseFrontmatter(text);
      const title = stringField(data, "title") || stripMd(file.name);
      const description = oneLine(stringField(data, "description") ?? "");
      entries.push({ title, url: file.name, description });
    }
  }

  entries.sort((a, b) => a.url.localeCompare(b.url));

  const indexPath = join(absDir, "index.md");
  const existing = existsSync(indexPath)
    ? await readFile(indexPath, "utf8")
    : null;
  const leadBlock = existing ? indexLeadBlock(existing) : null;
  const lead = leadBlock ? indexLeadLine(leadBlock) : null;
  const body = formatIndexFile({ isRoot: opts.isRoot, lead: leadBlock, entries });
  if (body === "") {
    if (existsSync(indexPath)) {
      await unlink(indexPath);
    }
    return { written, lead };
  }

  await writeFile(indexPath, body);
  written.push(relDir ? `${relDir}/index.md` : "index.md");
  return { written, lead };
}

function formatIndexFile(opts: {
  isRoot: boolean;
  lead: string | null;
  entries: IndexEntry[];
}): string {
  const chunks: string[] = [];
  if (opts.isRoot) {
    chunks.push('---\nokf_version: "0.1"\n---');
  }
  if (opts.lead) {
    chunks.push(opts.lead);
  }
  if (opts.entries.length > 0) {
    chunks.push(opts.entries.map(formatEntry).join("\n"));
  }
  if (chunks.length === 0) {
    return "";
  }
  return `${chunks.join("\n\n")}\n`;
}

function formatEntry(entry: IndexEntry): string {
  const bullet = `* [${entry.title}](<${entry.url}>)`;
  return entry.description ? `${bullet} - ${entry.description}` : bullet;
}

/** Prose in an index.md body above the first list item, or null. */
export function indexLeadBlock(content: string): string | null {
  const { body } = parseFrontmatter(content);
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (isListItem(line.trim())) {
      break;
    }
    lines.push(line);
  }
  const block = lines.join("\n").trim();
  return block || null;
}

/** First non-heading prose line of an index lead, or null. */
export function indexLeadLine(content: string): string | null {
  const block = indexLeadBlock(content);
  if (!block) {
    return null;
  }
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    return trimmed;
  }
  return null;
}

function isListItem(line: string): boolean {
  return line.startsWith("* ") || line.startsWith("- ") || line === "*" || line === "-";
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMd(filename: string): string {
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}
