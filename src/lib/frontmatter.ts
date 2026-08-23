import { parse as parseYaml } from "yaml";

export type ParsedFrontmatter = {
  data: Record<string, unknown>;
  body: string;
};

/** Split a markdown document into YAML frontmatter data and body. */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const split = splitFrontmatter(content);
  if (split === null) {
    return { data: {}, body: content };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(split.yaml);
  } catch {
    return { data: {}, body: split.body };
  }

  return { data: asMap(parsed), body: split.body };
}

function splitFrontmatter(
  content: string,
): { yaml: string; body: string } | null {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return null;
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return null;
  }
  return {
    yaml: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

function asMap(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
