import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexLeadBlock, indexLeadLine, reindex } from "./reindex.js";

async function makeKb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "glin-reindex-"));
  await mkdir(join(dir, "raw"));
  await mkdir(join(dir, "sources"));
  await mkdir(join(dir, "wiki"));
  return dir;
}

async function writeConcept(
  path: string,
  fields: { title?: string; description?: string },
): Promise<void> {
  const lines = ["---", "type: Wiki"];
  if (fields.title !== undefined) {
    lines.push(`title: ${JSON.stringify(fields.title)}`);
  }
  if (fields.description !== undefined) {
    lines.push(`description: ${JSON.stringify(fields.description)}`);
  }
  lines.push("---", "", `# ${fields.title ?? "untitled"}`, "");
  await writeFile(path, `${lines.join("\n")}\n`);
}

describe("reindex", () => {
  it("writes root index and skips empty trees", async () => {
    const dir = await makeKb();
    await writeFile(join(dir, "sources", "index.md"), "");
    const result = await reindex({ baseDir: dir });
    expect(result.written).toEqual(["index.md"]);

    const root = await readFile(join(dir, "index.md"), "utf8");
    expect(root).toBe(`---
okf_version: "0.1"
---

* [sources](<sources/>)
* [wiki](<wiki/>)
`);
    expect(existsSync(join(dir, "sources/index.md"))).toBe(false);
    expect(existsSync(join(dir, "wiki/index.md"))).toBe(false);
  });

  it("lists concepts from frontmatter with filename title fallback", async () => {
    const dir = await makeKb();
    await writeConcept(join(dir, "wiki", "effect-sizes.md"), {
      title: "Effect Sizes",
      description: "What 0.4 means.",
    });
    await writeFile(
      join(dir, "wiki", "no-title.md"),
      "---\ntype: Wiki\ndescription: untitled node\n---\n\n# No title\n",
    );

    await reindex({ baseDir: dir });

    expect(await readFile(join(dir, "wiki/index.md"), "utf8")).toBe(`* [Effect Sizes](<effect-sizes.md>) - What 0.4 means.
* [no-title](<no-title.md>) - untitled node
`);
  });

  it("collapses folded descriptions to one line", async () => {
    const dir = await makeKb();
    await writeFile(
      join(dir, "sources", "paper.md"),
      `---
type: Paper
title: Visible Learning
description: >
  Meta-synthesis updating effect sizes
  across influences on achievement.
---

# Visible Learning
`,
    );

    await reindex({ baseDir: dir });

    expect(await readFile(join(dir, "sources/index.md"), "utf8")).toBe(
      "* [Visible Learning](<paper.md>) - Meta-synthesis updating effect sizes across influences on achievement.\n",
    );
  });

  it("wraps destinations in angle brackets", async () => {
    const dir = await makeKb();
    await writeConcept(join(dir, "sources", "My Article Title.md"), {
      title: "My Article Title",
      description: "a post",
    });

    await reindex({ baseDir: dir });

    expect(await readFile(join(dir, "sources/index.md"), "utf8")).toBe(
      "* [My Article Title](<My Article Title.md>) - a post\n",
    );
  });

  it("preserves a lead block and rolls the first prose line up to the parent", async () => {
    const dir = await makeKb();
    await mkdir(join(dir, "wiki", "methodology"));
    await writeConcept(join(dir, "wiki", "methodology", "effect-sizes.md"), {
      title: "Effect Sizes",
      description: "What 0.4 means.",
    });
    await writeFile(
      join(dir, "wiki", "methodology", "index.md"),
      `# Methods

How we measure.

Longer notes that stay in this file.
`,
    );

    await reindex({ baseDir: dir });

    expect(await readFile(join(dir, "wiki/methodology/index.md"), "utf8")).toBe(
      `# Methods

How we measure.

Longer notes that stay in this file.

* [Effect Sizes](<effect-sizes.md>) - What 0.4 means.
`,
    );
    expect(await readFile(join(dir, "wiki/index.md"), "utf8")).toBe(
      `* [methodology](<methodology/>) - How we measure.
`,
    );
  });

  it("skips reserved files and adjunct trees", async () => {
    const dir = await makeKb();
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "wiki", "log.md"), "history\n");
    await writeFile(join(dir, "raw", "should-not-index.md"), "nope\n");
    await writeConcept(join(dir, "wiki", "keep.md"), {
      title: "Keep",
      description: "a node",
    });

    await reindex({ baseDir: dir });

    expect(await readFile(join(dir, "wiki/index.md"), "utf8")).toBe(
      "* [Keep](<keep.md>) - a node\n",
    );
    expect(await readFile(join(dir, "index.md"), "utf8")).not.toContain("assets");
    expect(await readFile(join(dir, "index.md"), "utf8")).not.toContain("raw");
  });

  it("is idempotent", async () => {
    const dir = await makeKb();
    await mkdir(join(dir, "wiki", "methodology"));
    await writeConcept(join(dir, "wiki", "zeta.md"), {
      title: "Zeta",
      description: "last",
    });
    await writeConcept(join(dir, "wiki", "methodology", "alpha.md"), {
      title: "Alpha",
      description: "first",
    });
    await writeFile(join(dir, "wiki", "methodology", "index.md"), "Methods.\n");

    await reindex({ baseDir: dir });
    const first = {
      root: await readFile(join(dir, "index.md"), "utf8"),
      wiki: await readFile(join(dir, "wiki/index.md"), "utf8"),
      methods: await readFile(join(dir, "wiki/methodology/index.md"), "utf8"),
    };

    await reindex({ baseDir: dir });
    expect(await readFile(join(dir, "index.md"), "utf8")).toBe(first.root);
    expect(await readFile(join(dir, "wiki/index.md"), "utf8")).toBe(first.wiki);
    expect(await readFile(join(dir, "wiki/methodology/index.md"), "utf8")).toBe(
      first.methods,
    );
  });
});

describe("indexLeadBlock", () => {
  it("keeps prose above the listing, including headings", () => {
    expect(
      indexLeadBlock(`# Sources

Faithful extractions.

* [Post](<post.md>) - a post
`),
    ).toBe(`# Sources

Faithful extractions.`);
  });

  it("returns null when the body starts with a listing", () => {
    expect(indexLeadBlock("* [Post](<post.md>) - a post\n")).toBeNull();
  });
});

describe("indexLeadLine", () => {
  it("reads the first prose line, skipping headings", () => {
    expect(
      indexLeadLine(`---
okf_version: "0.1"
---

# Sources

Working knowledge.

More detail.

* [wiki](<wiki/>)
`),
    ).toBe("Working knowledge.");
  });
});
