import { describe, expect, it } from "vitest";
import { findMarkdownRefs, rewriteMarkdownRefs, type MarkdownRef } from "./markdown.js";

describe("findMarkdownRefs", () => {
  it("inline image and link", () => {
    const md = "See [guide](/wiki/guide.md) and ![chart](/assets/abcd1234.png).";
    const refs = findMarkdownRefs(md);
    expect(refs).toHaveLength(2);
    expectRef(md, refs[0]!, {
      kind: "link",
      url: "/wiki/guide.md",
      text: "guide",
    });
    expectRef(md, refs[1]!, {
      kind: "image",
      url: "/assets/abcd1234.png", 
      text: "chart",
    });
  });

  it("formatted link text", () => {
    const md = "[**bold** text](/sources/post.md)";
    const refs = findMarkdownRefs(md);
    expect(refs).toHaveLength(1);
    expectRef(md, refs[0]!, {
      kind: "link",
      url: "/sources/post.md",
      text: "bold text",
    });
  });

  it("image without alt text", () => {
    const md = "![](/assets/abcd1234.png)";
    const refs = findMarkdownRefs(md);
    expect(refs).toHaveLength(1);
    expectRef(md, refs[0]!, {
      kind: "image",
      url: "/assets/abcd1234.png",
      text: "",
    });
  });

  it("skips fenced code", () => {
    const md = "```\n![not an image](/assets/x.png)\n```\n![real](/assets/y.png)";
    const refs = findMarkdownRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe("/assets/y.png");
  });

  it("inline math literals", () => {
    const md = "Energy $E=mc^2$ and ![plot](/assets/plot.png).";
    const refs = findMarkdownRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe("/assets/plot.png");
  });

  it("link inside a GFM table cell", () => {
    const md = "| col |\n| --- |\n| [item](/wiki/item.md) |";
    const refs = findMarkdownRefs(md);
    expect(refs).toHaveLength(1);
    expectRef(md, refs[0]!, {
      kind: "link",
      url: "/wiki/item.md",
      text: "item",
    });
  });

  it("skips reference-style links", () => {
    const md = "[inline](/wiki/a.md)\n\n[ref][id]\n\n[id]: /wiki/b.md";
    const refs = findMarkdownRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.url).toBe("/wiki/a.md");
  });
});

describe("rewriteMarkdownRefs", () => {
  it("replaces matching URLs", () => {
    const md = "![a](/assets/old.png) and [b](/wiki/old.md)";
    const out = rewriteMarkdownRefs(md, (ref) =>
      ref.url.startsWith("/assets/") ? "/assets/new.png" : undefined,
    );
    expect(out).toBe("![a](/assets/new.png) and [b](/wiki/old.md)");
  });

  it("leaves unmatched refs unchanged", () => {
    const md = "[keep](/wiki/keep.md)";
    const out = rewriteMarkdownRefs(md, () => undefined);
    expect(out).toBe(md);
  });
});

function expectRef(md: string, ref: MarkdownRef, expected: Omit<MarkdownRef, "position">) {
  expect(ref).toMatchObject(expected);
  expect(md.slice(ref.position.start, ref.position.end)).toContain(expected.url);
  expect(ref.position.start).toBeLessThan(ref.position.end);
}


