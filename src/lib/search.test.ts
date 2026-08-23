import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSearchMarkdown, search } from "./search.js";

async function makeKb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "glin-search-"));
  await mkdir(join(dir, "raw"));
  await mkdir(join(dir, "sources"));
  await mkdir(join(dir, "wiki"));
  return dir;
}

async function writeNode(
  path: string,
  frontmatter: string,
  body: string,
): Promise<void> {
  await writeFile(path, `---\n${frontmatter}\n---\n\n${body}\n`);
}

describe("search", () => {
  it("requires every term", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "wiki", "both.md"),
      "type: Wiki\ntitle: Effect Sizes\ndescription: both terms",
      "body",
    );
    await writeNode(
      join(dir, "wiki", "one.md"),
      "type: Wiki\ntitle: Effect only\ndescription: missing the other term",
      "body",
    );

    const result = await search({ query: "effect sizes", baseDir: dir });
    expect(result.hits.map((hit) => hit.path)).toEqual(["/wiki/both.md"]);
  });

  it("ranks title presence above repeated body matches", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "wiki", "body.md"),
      "type: Wiki\ntitle: Unrelated\ndescription: none of it",
      "qrankterm qrankterm qrankterm qrankterm qrankterm qrankterm qrankterm qrankterm qrankterm",
    );
    await writeNode(
      join(dir, "wiki", "title.md"),
      "type: Wiki\ntitle: Qrankterm\ndescription: none of it",
      "no match in the body here",
    );

    const result = await search({ query: "qrankterm", baseDir: dir });
    expect(result.hits.map((hit) => hit.path)).toEqual([
      "/wiki/title.md",
      "/wiki/body.md",
    ]);
    expect(result.hits[0]?.score).toBe(8);
    expect(result.hits[1]?.score).toBe(1);
  });

  it("regex", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "wiki", "hit.md"),
      "type: Wiki\ntitle: Hinge\ndescription: none",
      "the 0.4 hinge point",
    );
    await writeNode(
      join(dir, "wiki", "miss.md"),
      "type: Wiki\ntitle: Other\ndescription: none",
      "no numbers",
    );

    const result = await search({
      query: "0\\.4|hinge",
      baseDir: dir,
      regex: true,
    });
    expect(result.hits.map((hit) => hit.path)).toEqual(["/wiki/hit.md"]);
  });

  it("case-sensitive", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "wiki", "node.md"),
      "type: Wiki\ntitle: Effect\ndescription: none",
      "body",
    );

    const insensitive = await search({ query: "effect", baseDir: dir });
    expect(insensitive.hits).toHaveLength(1);

    const sensitive = await search({
      query: "effect",
      baseDir: dir,
      caseSensitive: true,
    });
    expect(sensitive.hits).toHaveLength(0);
  });

  it("skips index.md and log.md", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "wiki", "index.md"),
      "type: Wiki\ntitle: Index trap\ndescription: reservedunique",
      "reservedunique",
    );
    await writeNode(
      join(dir, "wiki", "log.md"),
      "type: Wiki\ntitle: Log trap\ndescription: reservedunique",
      "reservedunique",
    );
    await writeNode(
      join(dir, "wiki", "real.md"),
      "type: Wiki\ntitle: Real\ndescription: reservedunique",
      "body",
    );

    const result = await search({ query: "reservedunique", baseDir: dir });
    expect(result.scanned).toBe(1);
    expect(result.hits.map((hit) => hit.path)).toEqual(["/wiki/real.md"]);
  });

  it("searches non-boosted frontmatter", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "sources", "paper.md"),
      'type: Paper\ntitle: A Book\ndescription: none\nauthor: John Hattie',
      "body without the name",
    );

    const result = await search({ query: "Hattie", baseDir: dir });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.path).toBe("/sources/paper.md");
    expect(result.hits[0]?.score).toBe(4);
  });

  it("puts matching tags on the markdown bullet", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "wiki", "node.md"),
      "type: Wiki\ntitle: Methods\ndescription: a node\ntags: [methodology, ignored]",
      "body",
    );

    const result = await search({ query: "methodology", baseDir: dir });
    expect(result.hits[0]?.tags).toEqual(["methodology"]);
    expect(formatSearchMarkdown(result.hits)).toBe(
      "* [Methods](</wiki/node.md>) (methodology) - a node",
    );
  });

  it("markdown omits score; json keeps it", async () => {
    const dir = await makeKb();
    await writeNode(
      join(dir, "wiki", "node.md"),
      "type: Wiki\ntitle: Visible Learning\ndescription: a node",
      "Hattie in the body",
    );

    const result = await search({ query: "Hattie", baseDir: dir });
    const markdown = formatSearchMarkdown(result.hits);
    expect(markdown).toContain("* [Visible Learning](</wiki/node.md>) - a node");
    expect(markdown).toContain("Hattie in the body");
    expect(markdown).not.toContain("score");

    const json = JSON.stringify(result.hits);
    expect(json).toContain('"score":');
    expect(json).toContain('"/wiki/node.md"');
  });
});
