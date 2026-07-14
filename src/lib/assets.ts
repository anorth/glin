import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { contentHashBasename, resolveHashFilename } from "./hash-filename.js";
import { findMarkdownRefs, rewriteMarkdownRefs } from "./markdown.js";

const ASSET_PATH_PREFIX = "/assets/";
const KB_ASSETS_DIR = "assets";

export type AdoptSourceAssetsOptions = {
  /** Extracted source markdown body with archive-relative image refs. */
  markdown: string;
  /** Absolute path to the raw archive directory. */
  archivePath: string;
  /** KB root (contains assets/). */
  kbRoot: string;
};

export type AdoptSourceAssetsResult = {
  /** Markdown with adopted image refs rewritten to vault-root /assets/ paths. */
  markdown: string;
  /** Basenames copied into assets/ this run. */
  adopted: string[];
  /** Basenames already present in assets/ with matching content. */
  deduplicated: string[];
  /** Per-ref failures (missing file, etc.); other refs still adopted. */
  errors: string[];
};

/**
 * Copies every archive-relative image referenced in extracted markdown into the
 * pooled assets/ store under a content-hash basename (collision-suffixed when
 * needed), and rewrites those refs to vault-root absolute `/assets/<hash>.<ext>`
 * (leading slash; OKF-style bundle-relative).
 *
 * data: and blob: URLs are left untouched. Missing or unreadable archive files
 * are skipped and reported in `errors` so other refs can still succeed.
 */
export async function adoptSourceAssets(
  options: AdoptSourceAssetsOptions,
): Promise<AdoptSourceAssetsResult> {
  const relativeRefs = listArchiveRelativeImageRefs(options.markdown);
  const adopted: string[] = [];
  const deduplicated: string[] = [];
  const errors: string[] = [];
  const urlRewrites = new Map<string, string>();

  for (const relativeRef of relativeRefs) {
    try {
      const outcome = await adoptAsset(
        options.kbRoot,
        options.archivePath,
        relativeRef,
      );
      if (outcome.status === "adopted") {
        adopted.push(outcome.resolvedBasename);
      } else {
        deduplicated.push(outcome.resolvedBasename);
      }
      urlRewrites.set(
        relativeRef,
        `${ASSET_PATH_PREFIX}${outcome.resolvedBasename}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }

  // Remark round-trip is fine: callers write a new source file, not an in-place edit.
  const markdown =
    urlRewrites.size === 0
      ? options.markdown
      : rewriteMarkdownRefs(options.markdown, (ref) => urlRewrites.get(ref.url));

  return { markdown, adopted, deduplicated, errors };
}

/**
 * Image refs that are not valid in a written source node after adoption.
 * Allowed: vault-root `/assets/<file>` that resolves to an existing file under
 * kbRoot/assets/, plus data: and blob: URLs. Everything else (archive-relative
 * leftovers, http(s), invented /assets paths, …) is returned sorted.
 */
export function findInvalidSourceImageRefs(
  markdown: string,
  kbRoot: string,
): string[] {
  const invalid = new Set<string>();

  for (const ref of findMarkdownRefs(markdown)) {
    if (ref.kind !== "image") {
      continue;
    }
    if (isAllowedSourceImageRef(ref.url, kbRoot)) {
      continue;
    }
    invalid.add(ref.url);
  }

  return [...invalid].sort();
}

/** Archive-relative image URLs (e.g. images/foo.png) eligible for adoption. */
export function listArchiveRelativeImageRefs(markdown: string): string[] {
  const refs = new Set<string>();

  for (const ref of findMarkdownRefs(markdown)) {
    if (ref.kind !== "image") {
      continue;
    }
    if (isArchiveRelativeRef(ref.url)) {
      refs.add(ref.url);
    }
  }

  return [...refs].sort();
}

function isAllowedSourceImageRef(url: string, kbRoot: string): boolean {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  if (lower.startsWith("data:") || lower.startsWith("blob:")) {
    return true;
  }
  if (!url.startsWith(ASSET_PATH_PREFIX)) {
    return false;
  }
  const assetRel = url.slice(1); // assets/<file>
  if (!assetRel.startsWith(`${KB_ASSETS_DIR}/`) || assetRel.split("/").includes("..")) {
    return false;
  }
  const assetFile = assetRel.slice(KB_ASSETS_DIR.length + 1);
  if (!assetFile || assetFile.includes("/")) {
    // Only flat /assets/<file> — no nested paths.
    return false;
  }
  const resolved = resolve(kbRoot, assetRel);
  const rel = relative(resolve(kbRoot), resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }
  return existsSync(resolved);
}

function isArchiveRelativeRef(url: string): boolean {
  if (!url || url.includes("://") || url.startsWith("/")) {
    return false;
  }
  const lower = url.toLowerCase();
  if (lower.startsWith("data:") || lower.startsWith("blob:")) {
    return false;
  }
  return !url.split("/").includes("..");
}

function resolveArchiveRelativePath(
  archivePath: string,
  relativeRef: string,
): string {
  const resolved = resolve(archivePath, relativeRef);
  const rel = relative(resolve(archivePath), resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Archive image ref escapes archive: ${relativeRef}`);
  }
  return resolved;
}

function extensionFromArchiveRef(relativeRef: string): string | null {
  const ext = extname(basename(relativeRef))
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return ext || null;
}

type AdoptAssetOutcome = {
  status: "adopted" | "deduplicated";
  resolvedBasename: string;
};

async function adoptAsset(
  kbRoot: string,
  archivePath: string,
  relativeRef: string,
): Promise<AdoptAssetOutcome> {
  const sourcePath = resolveArchiveRelativePath(archivePath, relativeRef);
  const destDir = join(kbRoot, KB_ASSETS_DIR);

  if (!existsSync(sourcePath)) {
    throw new Error(
      `Archive image not found for ${relativeRef}: ${sourcePath}`,
    );
  }

  const sourceBody = await readFile(sourcePath);
  const assetBasename = contentHashBasename(
    sourceBody,
    extensionFromArchiveRef(relativeRef),
  );
  const resolvedBasename = await resolveHashFilename(
    destDir,
    assetBasename,
    sourceBody,
  );
  const destPath = join(destDir, resolvedBasename);

  if (existsSync(destPath)) {
    return { status: "deduplicated", resolvedBasename };
  }

  await mkdir(destDir, { recursive: true });
  await writeFile(destPath, sourceBody);
  return { status: "adopted", resolvedBasename };
}
