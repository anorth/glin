import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  listConceptFiles,
  oneLine,
  stringField,
  stripMd,
} from "./concepts.js";
import { parseFrontmatter } from "./frontmatter.js";
import { requireBaseDir } from "./kb.js";

const TITLE_WEIGHT = 8;
const DESCRIPTION_WEIGHT = 4;
const TAGS_WEIGHT = 4;
const FRONTMATTER_WEIGHT = 4;
const BODY_WEIGHT = 1;

const BOOSTED_FRONTMATTER = new Set(["title", "description", "tags"]);

export const DEFAULT_SEARCH_LIMIT = 100;
const MAX_SNIPPETS = 3;
const SNIPPET_RADIUS = 60;

export type SearchHit = {
  path: string;
  title: string;
  description: string;
  score: number;
  snippets: string[];
  tags: string[];
};

export type SearchResult = {
  hits: SearchHit[];
  scanned: number;
};

export type SearchOptions = {
  query: string;
  baseDir?: string;
  limit?: number;
  caseSensitive?: boolean;
  regex?: boolean;
};

type Matcher = {
  first(haystack: string): { index: number; length: number } | null;
};

type CompiledQuery = {
  matchers: Matcher[];
  prepare: (text: string) => string;
};

type Field = {
  original: string;
  search: string;
};

/** Search sources/ and wiki/ concept nodes. No persisted index. */
export async function search(options: SearchOptions): Promise<SearchResult> {
  const root = requireBaseDir(options.baseDir);
  const compiled = compileQuery(options.query, {
    caseSensitive: options.caseSensitive === true,
    regex: options.regex === true,
  });
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  const files = await listConceptFiles(root);
  const hits: SearchHit[] = [];
  for (const rel of files) {
    const text = await readFile(join(root, ...rel.split("/")), "utf8");
    const hit = scoreFile(`/${rel}`, text, compiled);
    if (hit) {
      hits.push(hit);
    }
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { hits: hits.slice(0, limit), scanned: files.length };
}

/** Markdown listing for agents. Rank is list order; score is omitted. */
export function formatSearchMarkdown(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return "No hits.";
  }
  return hits.map(formatHit).join("\n");
}

function formatHit(hit: SearchHit): string {
  const tags = hit.tags.length > 0 ? ` (${hit.tags.join(", ")})` : "";
  const bullet = `* [${hit.title}](<${hit.path}>)${tags}`;
  const head = hit.description ? `${bullet} - ${hit.description}` : bullet;
  const extra = hit.snippets.filter(
    (snippet) => snippet !== hit.description && snippet !== hit.title,
  );
  if (extra.length === 0) {
    return head;
  }
  return [head, ...extra.map((snippet) => `  ${snippet}`)].join("\n");
}

function compileQuery(
  query: string,
  opts: { caseSensitive: boolean; regex: boolean },
): CompiledQuery {
  const trimmed = query.trim();
  if (trimmed === "") {
    throw new Error("query is empty");
  }
  const prepare =
    opts.regex || opts.caseSensitive
      ? (text: string) => text
      : (text: string) => text.toLowerCase();
  if (opts.regex) {
    return { matchers: [regexMatcher(trimmed, opts.caseSensitive)], prepare };
  }
  return {
    matchers: trimmed.split(/\s+/).map((term) => literalMatcher(prepare(term))),
    prepare,
  };
}

function literalMatcher(needle: string): Matcher {
  return {
    first(haystack) {
      const at = haystack.indexOf(needle);
      return at === -1 ? null : { index: at, length: needle.length };
    },
  };
}

function regexMatcher(pattern: string, caseSensitive: boolean): Matcher {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid regular expression: ${detail}`);
  }
  return {
    first(haystack) {
      regex.lastIndex = 0;
      const match = regex.exec(haystack);
      return match === null ? null : { index: match.index, length: match[0].length };
    },
  };
}

function scoreFile(path: string, text: string, compiled: CompiledQuery): SearchHit | null {
  const { data, body } = parseFrontmatter(text);
  const { matchers, prepare } = compiled;
  const title = stringField(data, "title") || stripMd(path);
  const description = stringField(data, "description") ?? "";
  const tagList = parseTags(data);
  const otherOriginal = flattenFrontmatter(data, BOOSTED_FRONTMATTER);

  const titleField = makeField(title, prepare);
  const descriptionField = makeField(description, prepare);
  const otherField = makeField(otherOriginal, prepare);
  const bodyField = makeField(body, prepare);
  const preparedTags = tagList.map((tag) => ({
    original: tag,
    search: prepare(tag),
  }));

  const presentIn = (field: Field): boolean[] =>
    matchers.map((matcher) => matcher.first(field.search) !== null);
  const titleHits = presentIn(titleField);
  const descriptionHits = presentIn(descriptionField);
  const tagHits = matchers.map((matcher) =>
    preparedTags.some((tag) => matcher.first(tag.search) !== null),
  );
  const otherHits = presentIn(otherField);
  const bodyHits = presentIn(bodyField);

  const matched = matchers.every(
    (_, i) =>
      titleHits[i] ||
      descriptionHits[i] ||
      tagHits[i] ||
      otherHits[i] ||
      bodyHits[i],
  );
  if (!matched) {
    return null;
  }

  const score =
    (anyPresent(titleHits) ? TITLE_WEIGHT : 0) +
    (anyPresent(descriptionHits) ? DESCRIPTION_WEIGHT : 0) +
    (anyPresent(tagHits) ? TAGS_WEIGHT : 0) +
    (anyPresent(otherHits) ? FRONTMATTER_WEIGHT : 0) +
    (anyPresent(bodyHits) ? BODY_WEIGHT : 0);

  const tags = preparedTags
    .filter((tag) => matchers.some((matcher) => matcher.first(tag.search) !== null))
    .map((tag) => tag.original);

  return {
    path,
    title,
    description: oneLine(description),
    score,
    tags,
    snippets: collectSnippets(
      bodyField,
      descriptionField,
      otherField,
      titleField,
      matchers,
    ),
  };
}

function collectSnippets(
  body: Field,
  description: Field,
  other: Field,
  title: Field,
  matchers: Matcher[],
): string[] {
  const snippets: string[] = [];
  const seen = new Set<number>();
  for (const matcher of matchers) {
    if (snippets.length >= MAX_SNIPPETS) {
      break;
    }
    const hit = matcher.first(body.search);
    if (hit === null || seen.has(hit.index)) {
      continue;
    }
    seen.add(hit.index);
    snippets.push(snippetAt(body.original, hit.index, hit.length));
  }
  if (snippets.length === 0) {
    for (const field of [description, other, title]) {
      const hit = firstHit(field.search, matchers);
      if (hit) {
        snippets.push(snippetAt(field.original, hit.index, hit.length));
        break;
      }
    }
  }
  return snippets;
}

function firstHit(
  text: string,
  matchers: Matcher[],
): { index: number; length: number } | null {
  for (const matcher of matchers) {
    const hit = matcher.first(text);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function snippetAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + Math.max(length, 1) + SNIPPET_RADIUS);
  let snippet = oneLine(text.slice(start, end));
  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < text.length) {
    snippet = `${snippet}…`;
  }
  return snippet;
}

function makeField(original: string, prepare: (text: string) => string): Field {
  return { original, search: prepare(original) };
}

function parseTags(data: Record<string, unknown>): string[] {
  const tags = data.tags;
  if (typeof tags === "string" && tags.trim() !== "") {
    return [tags.trim()];
  }
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
      .map((tag) => tag.trim());
  }
  return [];
}

function flattenFrontmatter(
  data: Record<string, unknown>,
  omit: Set<string>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (omit.has(key)) {
      continue;
    }
    parts.push(...flattenValue(value));
  }
  return parts.join(" ");
}

function flattenValue(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() === "" ? [] : [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenValue);
  }
  if (value instanceof Date) {
    return [value.toISOString()];
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(flattenValue);
  }
  return [];
}

function anyPresent(flags: boolean[]): boolean {
  return flags.some(Boolean);
}
