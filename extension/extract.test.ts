import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runExtract,
  type ExtractModelCall,
} from "./extract.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_HASH = "c414cd0e204de974";

const ARCHIVE = "raw/example.com/blog-my-post";
const OUTPUT = "sources/example.com/My Post.md";

describe("runExtract", () => {
  let kbDir: string | undefined;

  afterEach(async () => {
    if (kbDir) {
      await rm(kbDir, { recursive: true, force: true });
      kbDir = undefined;
    }
  });

  async function setupKb(options?: {
    author?: string;
    publication?: string;
    image?: boolean;
  }): Promise<string> {
    kbDir = await mkdtemp(join(tmpdir(), "glin-extract-test-"));
    const archivePath = join(kbDir, ...ARCHIVE.split("/"));
    await mkdir(join(archivePath, "images"), { recursive: true });
    await mkdir(join(kbDir, "sources", "example.com"), { recursive: true });

    const meta: Record<string, unknown> = {
      source_url: "https://example.com/blog/my-post",
      final_url: "https://example.com/blog/my-post/",
      canonical_url: "https://example.com/blog/my-post/",
      fetched: "2026-07-14T12:00:00.000Z",
      title: "Meta Title | Example",
    };
    if (options?.author) {
      meta.author = options.author;
    }
    if (options?.publication) {
      meta.publication = options.publication;
    }
    await writeFile(join(archivePath, "meta.json"), JSON.stringify(meta));
    await writeFile(
      join(archivePath, "index.html"),
      "<html><body><h1>Hi</h1><p>Body</p></body></html>",
    );
    if (options?.image !== false) {
      await writeFile(
        join(archivePath, "images", `${PNG_HASH}.png`),
        PNG,
      );
    }
    return kbDir;
  }

  function modelCallReturning(
    body: string,
    meta: {
      description?: string;
      author?: string | null;
      publication?: string | null;
    } = {},
  ): ExtractModelCall {
    const payload = {
      description:
        meta.description ?? "A short navigation description of the article.",
      author: meta.author === undefined ? null : meta.author,
      publication: meta.publication === undefined ? null : meta.publication,
    };
    let call = 0;
    return async () => {
      call += 1;
      if (call === 1) {
        return { text: body, usage: zeroUsage() };
      }
      return { text: JSON.stringify(payload), usage: zeroUsage() };
    };
  }

  function zeroUsage() {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  }

  it("happy path writes frontmatter, body, and adopted assets", async () => {
    const kbRoot = await setupKb({
      author: "Ada Lovelace",
      publication: "Example Journal",
    });
    const body = [
      "# My Post",
      "",
      "By Ada Lovelace",
      "",
      `![chart](images/${PNG_HASH}.png)`,
      "",
      "Paragraph.",
    ].join("\n");
    // Model disagrees on author; meta wins. Model fills publication only if meta absent —
    // here meta has publication, so model value is ignored.
    const modelCall = modelCallReturning(body, {
      author: "Wrong Author",
      publication: "Wrong Pub",
    });

    const result = await runExtract(
      { archive: ARCHIVE, output: OUTPUT },
      undefined,
      undefined,
      { cwd: kbRoot },
      { modelCall },
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.adopted).toEqual([`${PNG_HASH}.png`]);
    const written = await readFile(join(kbRoot, OUTPUT), "utf8");
    expect(written).not.toMatch(/^id:/m);
    expect(written).toContain("type: Article");
    expect(written).toContain('title: "My Post"');
    expect(written).toContain('author: "Ada Lovelace"');
    expect(written).toContain('publication: "Example Journal"');
    expect(written).not.toContain("Wrong Author");
    expect(written).not.toContain("Wrong Pub");
    expect(written).toContain('resource: "https://example.com/blog/my-post/"');
    expect(written).not.toMatch(/^source_url:/m);
    expect(written).toContain('fetched: "2026-07-14"');
    expect(written).toContain(`raw: "${ARCHIVE}/"`);
    expect(written).toContain(
      'description: "A short navigation description of the article."',
    );
    expect(written).not.toMatch(/^summary:/m);
    expect(written).toContain(`![chart](/assets/${PNG_HASH}.png)`);
    expect(written).toContain("# My Post");
    expect(await readFile(join(kbRoot, "assets", `${PNG_HASH}.png`))).toEqual(
      PNG,
    );
  });

  it("no leading H1", async () => {
    const kbRoot = await setupKb();
    const result = await runExtract(
      { archive: ARCHIVE, output: OUTPUT },
      undefined,
      undefined,
      { cwd: kbRoot },
      { modelCall: modelCallReturning("Just a paragraph.\n") },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("H1"),
    });
    expect(existsSync(join(kbRoot, OUTPUT))).toBe(false);
  });

  it("adoption miss", async () => {
    const kbRoot = await setupKb({ image: false });
    const body = [
      "# My Post",
      "",
      `![missing](images/${PNG_HASH}.png)`,
    ].join("\n");

    const result = await runExtract(
      { archive: ARCHIVE, output: OUTPUT },
      undefined,
      undefined,
      { cwd: kbRoot },
      { modelCall: modelCallReturning(body) },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("asset adoption failed"),
    });
    expect(existsSync(join(kbRoot, OUTPUT))).toBe(false);
  });

  it("invalid image refs", async () => {
    const kbRoot = await setupKb();
    const body = [
      "# My Post",
      "",
      "![remote](https://example.test/x.png)",
    ].join("\n");

    const result = await runExtract(
      { archive: ARCHIVE, output: OUTPUT },
      undefined,
      undefined,
      { cwd: kbRoot },
      { modelCall: modelCallReturning(body) },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Invalid image refs"),
    });
    expect(existsSync(join(kbRoot, OUTPUT))).toBe(false);
  });

  it("path escape", async () => {
    const kbRoot = await setupKb();
    let called = 0;
    const modelCall: ExtractModelCall = async () => {
      called += 1;
      return { text: "# X", usage: zeroUsage() };
    };

    const result = await runExtract(
      { archive: ARCHIVE, output: "../outside.md" },
      undefined,
      undefined,
      { cwd: kbRoot },
      { modelCall },
    );

    expect(result.isError).toBe(true);
    expect(called).toBe(0);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(/Invalid output path|must be under sources/),
    });
  });

  it("omits author when absent from meta", async () => {
    const kbRoot = await setupKb();
    const body = ["# My Post", "", "Hello."].join("\n");

    const result = await runExtract(
      { archive: ARCHIVE, output: OUTPUT },
      undefined,
      undefined,
      { cwd: kbRoot },
      { modelCall: modelCallReturning(body) },
    );

    expect(result.isError).toBeFalsy();
    const written = await readFile(join(kbRoot, OUTPUT), "utf8");
    expect(written).not.toMatch(/^author:/m);
    expect(written).not.toMatch(/^publication:/m);
    expect(written).toContain('title: "My Post"');
  });

  it("infers author and publication from description call when meta omits them", async () => {
    const kbRoot = await setupKb();
    const body = ["# My Post", "", "Hello."].join("\n");

    const result = await runExtract(
      { archive: ARCHIVE, output: OUTPUT },
      undefined,
      undefined,
      { cwd: kbRoot },
      {
        modelCall: modelCallReturning(body, {
          author: "Grace Hopper",
          publication: "Naval Review",
        }),
      },
    );

    expect(result.isError).toBeFalsy();
    const written = await readFile(join(kbRoot, OUTPUT), "utf8");
    expect(written).toContain('author: "Grace Hopper"');
    expect(written).toContain('publication: "Naval Review"');
  });

  it("PDF archive extracts to type Paper", async () => {
    kbDir = await mkdtemp(join(tmpdir(), "glin-extract-pdf-"));
    const archiveRel = "raw/example.com/paper.pdf";
    const outputRel = "sources/example.com/Hello Paper.md";
    const archivePath = join(kbDir, ...archiveRel.split("/"));
    await mkdir(archivePath, { recursive: true });
    await mkdir(join(kbDir, "sources", "example.com"), { recursive: true });
    await writeFile(
      join(archivePath, "meta.json"),
      JSON.stringify({
        source_url: "https://example.com/paper.pdf",
        final_url: "https://example.com/paper.pdf",
        fetched: "2026-08-10T12:00:00.000Z",
        content_type: "application/pdf",
        filename: "paper.pdf",
      }),
    );
    await writeFile(join(archivePath, "document.pdf"), MINIMAL_PDF);

    const body = ["# Hello Paper", "", "Hello from the PDF."].join("\n");
    const result = await runExtract(
      { archive: archiveRel, output: outputRel },
      undefined,
      undefined,
      { cwd: kbDir },
      { modelCall: modelCallReturning(body) },
    );

    expect(result.isError).toBeFalsy();
    const written = await readFile(join(kbDir, outputRel), "utf8");
    expect(written).toContain("type: Paper");
    expect(written).toContain('title: "Hello Paper"');
    expect(written).toContain(`raw: "${archiveRel}/"`);
    expect(written).toContain("# Hello Paper");
  });
});

/** Tiny one-page PDF whose text layer is "Hello". */
const MINIMAL_PDF = new TextEncoder().encode(`%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 100 100 Td (Hello) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000361 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`);
