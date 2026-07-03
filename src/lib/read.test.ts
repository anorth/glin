import { describe, expect, it } from "vitest";
import {
  BinaryContentError,
  formatReadMetadata,
  readPage,
} from "./read.js";
import type { HttpGetFn, HttpResponse } from "./http.js";

const PAGE_URL = "http://example.test/old";
const FINAL_URL = "http://example.test/new/";

const PAGE_HTML = `<!DOCTYPE html><html><head>
<title>Index Page</title>
<style>.x{}</style>
<script>noise()</script>
</head><body>
<a href="/articles/one">One</a>
<img src="/img.png">
</body></html>`;

function mockHttpGet(responses: Record<string, HttpResponse>): HttpGetFn {
  return async (url) => {
    const response = responses[url];
    if (!response) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return response;
  };
}

describe("readPage", () => {
  it("returns cleaned HTML with absolutized links", async () => {
    const result = await readPage({
      sourceUrl: PAGE_URL,
      httpGet: mockHttpGet({
        [PAGE_URL]: {
          url: FINAL_URL,
          status: 200,
          contentType: "text/html",
          charset: "utf-8",
          body: Buffer.from(PAGE_HTML),
        },
      }),
    });

    expect(result.final_url).toBe(FINAL_URL);
    expect(result.title).toBe("Index Page");
    expect(result.content).not.toContain("<script");
    expect(result.content).not.toContain("<style");
    expect(result.content).toContain('href="http://example.test/articles/one"');
    expect(result.content).toContain('src="http://example.test/img.png"');
  });

  it("preserves script and style when omit flags are false", async () => {
    const result = await readPage({
      sourceUrl: PAGE_URL,
      omitScripts: false,
      omitStyles: false,
      httpGet: mockHttpGet({
        [PAGE_URL]: {
          url: PAGE_URL,
          status: 200,
          contentType: "text/html",
          charset: "utf-8",
          body: Buffer.from(PAGE_HTML),
        },
      }),
    });

    expect(result.content).toContain("<script");
    expect(result.content).toContain("<style");
  });

  it("returns non-HTML text verbatim", async () => {
    const body = "# Hello\n\nWorld";
    const result = await readPage({
      sourceUrl: "http://example.test/readme.md",
      httpGet: mockHttpGet({
        "http://example.test/readme.md": {
          url: "http://example.test/readme.md",
          status: 200,
          contentType: "text/markdown",
          charset: "utf-8",
          body: Buffer.from(body),
        },
      }),
    });

    expect(result.content).toBe(body);
    expect(result.title).toBeNull();
  });

  it("rejects binary content", async () => {
    await expect(
      readPage({
        sourceUrl: "http://example.test/doc.pdf",
        httpGet: mockHttpGet({
          "http://example.test/doc.pdf": {
            url: "http://example.test/doc.pdf",
            status: 200,
            contentType: "application/pdf",
            charset: "utf-8",
            body: Buffer.from("%PDF-1.4"),
          },
        }),
      }),
    ).rejects.toBeInstanceOf(BinaryContentError);
  });
});

describe("formatReadMetadata", () => {
  it("includes redirect note when source and final URLs differ", () => {
    const line = formatReadMetadata({
      source_url: "http://example.test/old",
      final_url: "http://example.test/new/",
      content_type: "text/html",
      title: "Index Page",
      content: "",
    });

    expect(line).toBe(
      "final_url: http://example.test/new/ (from http://example.test/old) content_type: text/html title: Index Page",
    );
  });

  it("omits title when null", () => {
    const line = formatReadMetadata({
      source_url: "http://example.test/x",
      final_url: "http://example.test/x",
      content_type: "text/plain",
      title: null,
      content: "hi",
    });

    expect(line).toBe(
      "final_url: http://example.test/x content_type: text/plain",
    );
  });
});
