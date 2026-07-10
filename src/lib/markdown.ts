import type { Image, Link, PhrasingContent, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export type MarkdownRefKind = "image" | "link";

export type MarkdownRefPosition = {
  /** 0-based byte offset into the source string. */
  start: number;
  /** 0-based exclusive end offset. */
  end: number;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
};

export type MarkdownRef = {
  kind: MarkdownRefKind;
  url: string;
  /** Alt text for images; plain text for links. */
  text: string;
  position: MarkdownRefPosition;
};

/** Enumerates inline image and link references in a markdown body. */
export function findMarkdownRefs(markdown: string): MarkdownRef[] {
  const tree = parseMarkdown(markdown);
  const refs: MarkdownRef[] = [];

  visit(tree, (node) => {
    if (node.type === "image" || node.type === "link") {
      refs.push(refFromNode(node));
    }
  });

  return refs;
}

/**
 * Rewrites inline image and link references in a markdown body.
 * Return a new URL from the callback to replace; return undefined to leave unchanged.
 */
export function rewriteMarkdownRefs(
  markdown: string,
  rewrite: (ref: MarkdownRef) => string | undefined,
): string {
  const tree = parseMarkdown(markdown);

  visit(tree, (node) => {
    if (node.type !== "image" && node.type !== "link") {
      return;
    }

    const ref = refFromNode(node);
    const nextUrl = rewrite(ref);
    if (nextUrl !== undefined) {
      node.url = nextUrl;
    }
  });

  return stringifyMarkdown(tree, markdown);
}

type RefNode = Image | Link;

const parser = unified().use(remarkParse).use(remarkGfm);
const stringifier = unified().use(remarkGfm).use(remarkStringify);

function parseMarkdown(markdown: string): Root {
  return parser.parse(markdown) as Root;
}

function stringifyMarkdown(tree: Root, original: string): string {
  let out = stringifier.stringify(tree);
  if (!original.endsWith("\n") && out.endsWith("\n")) {
    out = out.slice(0, -1);
  }
  return out;
}

function positionFromNode(node: RefNode): MarkdownRefPosition {
  const pos = node.position;
  if (!pos) {
    throw new Error(`markdown node is missing source position: ${node.type}`);
  }
  return {
    start: pos.start.offset ?? 0,
    end: pos.end.offset ?? 0,
    line: pos.start.line,
    column: pos.start.column,
  };
}

function textFromChildren(children: PhrasingContent[]): string {
  let text = "";
  for (const child of children) {
    if (child.type === "text") {
      text += child.value;
    } else if ("children" in child) {
      text += textFromChildren(child.children as PhrasingContent[]);
    }
  }
  return text;
}

function refFromNode(node: RefNode): MarkdownRef {
  return {
    kind: node.type,
    url: node.url,
    text: node.type === "image" ? (node.alt ?? "") : textFromChildren(node.children),
    position: positionFromNode(node),
  };
}

