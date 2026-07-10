import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPage, resolveHashFilename } from "./fetch.js";
import { ACCEPT_CSS, ACCEPT_IMAGE, type HttpGetFn, type HttpResponse } from "./http.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_HASH = "c414cd0e204de974";
const CSS_HASH = "5de625c36355cce7";

const PAGE_URL = "http://example.test/blog/post/";
const IMAGE_URL = "http://example.test/photo.png";
const CSS_URL = "http://example.test/site.css";
const PDF_URL = "http://example.test/paper.pdf";

const PAGE_HTML = `<!DOCTYPE html>
<html><head>
<title>Test Article</title>
<link rel="stylesheet" href="/site.css">
<link rel="canonical" href="/blog/post/">
<script>window.__plugin = function(){}</script>
<script type="application/json" id="__NEXT_DATA__">{"props":{"pageProps":{"title":"Test Article"}}}</script>
</head><body>
<img src="/photo.png" alt="test">
<a href="/paper.pdf">PDF</a>
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

function fixtureHttpGet(): HttpGetFn {
  return mockHttpGet({
    [PAGE_URL]: {
      url: PAGE_URL,
      status: 200,
      contentType: "text/html",
      charset: "utf-8",
      body: Buffer.from(PAGE_HTML),
    },
    [IMAGE_URL]: {
      url: IMAGE_URL,
      status: 200,
      contentType: "image/png",
      charset: "utf-8",
      body: PNG,
    },
    [CSS_URL]: {
      url: CSS_URL,
      status: 200,
      contentType: "text/css",
      charset: "utf-8",
      body: Buffer.from("body { color: red; }"),
    },
  });
}

describe("fetchPage", () => {
  let kbDir: string | undefined;

  afterEach(async () => {
    if (kbDir) {
      await rm(kbDir, { recursive: true, force: true });
    }
  });

  async function setupKb(): Promise<string> {
    kbDir = await mkdtemp(join(tmpdir(), "glin-fetch-test-"));
    await mkdir(join(kbDir, "raw"), { recursive: true });
    return kbDir;
  }

  it("archives HTML with localized images and stylesheets to raw/", async () => {
    const baseDir = await setupKb();

    const result = await fetchPage({
      sourceUrl: PAGE_URL,
      baseDir,
      group: "myblog",
      httpGet: fixtureHttpGet(),
      log: () => {},
    });

    expect(result.title).toBe("Test Article");
    expect(result.canonical_url).toBe(PAGE_URL);
    expect(result.images).toBe(1);
    expect(result.stylesheets).toBe(1);
    expect(result.linked_media).toEqual([{ url: PDF_URL, type: "pdf" }]);
    expect(result.archive_path).toBe("raw/example.test/myblog/blog-post");

    const archivePath = join(baseDir, result.archive_path);
    const indexHtml = await readFile(join(archivePath, "index.html"), "utf8");
    expect(indexHtml).toContain(`src="images/${PNG_HASH}.png"`);
    expect(indexHtml).toContain(`data-original-src="${IMAGE_URL}"`);
    expect(indexHtml).toContain(`href="styles/${CSS_HASH}.css"`);
    expect(indexHtml).toContain(`data-original-href="${CSS_URL}"`);
    expect(indexHtml).toContain("Content-Security-Policy");
    expect(indexHtml).toContain("img-src * data: blob:");
    expect(indexHtml).toContain("style-src 'self' 'unsafe-inline'");
    expect(indexHtml).toContain("font-src http: https: data:");
    expect(indexHtml).toContain("script-src 'none'");

    expect(indexHtml).not.toContain("window.__plugin");
    expect(indexHtml).toContain('id="__NEXT_DATA__"');
    expect(indexHtml).toContain("application/json");

    const images = await readdir(join(archivePath, "images"));
    expect(images).toContain(`${PNG_HASH}.png`);

    const styles = await readdir(join(archivePath, "styles"));
    expect(styles).toContain(`${CSS_HASH}.css`);

    const meta = JSON.parse(await readFile(join(archivePath, "meta.json"), "utf8"));
    expect(meta.stylesheets).toBe(1);
    expect(meta.scripts_stripped).toBe(1);
    expect(meta.styles_stripped).toBe(0);
    expect(meta.archive_path).toBeUndefined();

    const parentEntries = await readdir(join(baseDir, "raw", "example.test", "myblog"));
    expect(parentEntries.some((entry) => entry.includes(".tmp-"))).toBe(false);
  });

  it("suffixes truncated-hash collisions when content differs", async () => {
    const assetDir = await mkdtemp(join(tmpdir(), "glin-hash-collision-"));
    try {
      const basename = `${PNG_HASH}.png`;
      const otherBody = Buffer.from("different bytes");
      await writeFile(join(assetDir, basename), otherBody);

      const resolved = await resolveHashFilename(assetDir, basename, PNG);
      expect(resolved).toBe(`${PNG_HASH}-2.png`);
    } finally {
      await rm(assetDir, { recursive: true, force: true });
    }
  });

  it("deduplicates identical assets referenced from different URLs", async () => {
    const baseDir = await setupKb();
    const altImageUrl = "http://example.test/assets/photo-copy.png";
    const html = PAGE_HTML.replace(
      '<img src="/photo.png" alt="test">',
      '<img src="/photo.png" alt="one"><img src="/assets/photo-copy.png" alt="two">',
    );

    const result = await fetchPage({
      sourceUrl: PAGE_URL,
      baseDir,
      httpGet: mockHttpGet({
        [PAGE_URL]: {
          url: PAGE_URL,
          status: 200,
          contentType: "text/html",
          charset: "utf-8",
          body: Buffer.from(html),
        },
        [IMAGE_URL]: {
          url: IMAGE_URL,
          status: 200,
          contentType: "image/png",
          charset: "utf-8",
          body: PNG,
        },
        [altImageUrl]: {
          url: altImageUrl,
          status: 200,
          contentType: "image/png",
          charset: "utf-8",
          body: PNG,
        },
        [CSS_URL]: {
          url: CSS_URL,
          status: 200,
          contentType: "text/css",
          charset: "utf-8",
          body: Buffer.from("body { color: red; }"),
        },
      }),
      log: () => {},
    });

    expect(result.images).toBe(2);
    const archivePath = join(baseDir, result.archive_path);
    const indexHtml = await readFile(join(archivePath, "index.html"), "utf8");
    expect(indexHtml).toContain(`src="images/${PNG_HASH}.png"`);
    expect(indexHtml.match(new RegExp(`src="images/${PNG_HASH}\\.png"`, "g"))).toHaveLength(2);

    const images = await readdir(join(archivePath, "images"));
    expect(images).toEqual([`${PNG_HASH}.png`]);
  });

  it("uses content-type extension when the source URL has none", async () => {
    const baseDir = await setupKb();
    const extensionlessImageUrl = "http://example.test/image";
    const html = PAGE_HTML.replace(
      '<img src="/photo.png" alt="test">',
      '<img src="/image" alt="test">',
    );

    const result = await fetchPage({
      sourceUrl: PAGE_URL,
      baseDir,
      httpGet: mockHttpGet({
        [PAGE_URL]: {
          url: PAGE_URL,
          status: 200,
          contentType: "text/html",
          charset: "utf-8",
          body: Buffer.from(html),
        },
        [extensionlessImageUrl]: {
          url: extensionlessImageUrl,
          status: 200,
          contentType: "image/png",
          charset: "utf-8",
          body: PNG,
        },
        [CSS_URL]: {
          url: CSS_URL,
          status: 200,
          contentType: "text/css",
          charset: "utf-8",
          body: Buffer.from("body { color: red; }"),
        },
      }),
      log: () => {},
    });

    const archivePath = join(baseDir, result.archive_path);
    const indexHtml = await readFile(join(archivePath, "index.html"), "utf8");
    expect(indexHtml).toContain(`src="images/${PNG_HASH}.png"`);
    expect(await readdir(join(archivePath, "images"))).toEqual([`${PNG_HASH}.png`]);
  });

  it("replaces an existing archive and logs the overwrite", async () => {
    const baseDir = await setupKb();
    const log = vi.fn();
    const httpGet = fixtureHttpGet();

    await fetchPage({ sourceUrl: PAGE_URL, baseDir, group: "myblog", httpGet, log });
    await fetchPage({ sourceUrl: PAGE_URL, baseDir, group: "myblog", httpGet, log });

    expect(log.mock.calls.some(([message]) => message.includes("replacing existing archive"))).toBe(
      true,
    );
  });

  it("keeps executable scripts when --omit-scripts=no", async () => {
    const baseDir = await setupKb();

    const result = await fetchPage({
      sourceUrl: PAGE_URL,
      baseDir,
      omitScripts: false,
      httpGet: fixtureHttpGet(),
      log: () => {},
    });

    expect(result.scripts_stripped).toBe(0);
    const indexHtml = await readFile(
      join(baseDir, result.archive_path, "index.html"),
      "utf8",
    );
    expect(indexHtml).toContain("window.__plugin");
  });

  it("strips inline styles when --omit-styles=yes", async () => {
    const baseDir = await setupKb();
    const htmlWithStyle = PAGE_HTML.replace(
      "<link rel=\"stylesheet\"",
      "<style>body{color:red}</style><link rel=\"stylesheet\"",
    );

    const result = await fetchPage({
      sourceUrl: PAGE_URL,
      baseDir,
      omitStyles: true,
      httpGet: mockHttpGet({
        [PAGE_URL]: {
          url: PAGE_URL,
          status: 200,
          contentType: "text/html",
          charset: "utf-8",
          body: Buffer.from(htmlWithStyle),
        },
        [IMAGE_URL]: {
          url: IMAGE_URL,
          status: 200,
          contentType: "image/png",
          charset: "utf-8",
          body: PNG,
        },
        [CSS_URL]: {
          url: CSS_URL,
          status: 200,
          contentType: "text/css",
          charset: "utf-8",
          body: Buffer.from("body { color: red; }"),
        },
      }),
      log: () => {},
    });

    expect(result.styles_stripped).toBe(1);
    const indexHtml = await readFile(
      join(baseDir, result.archive_path, "index.html"),
      "utf8",
    );
    expect(indexHtml).not.toContain("body{color:red}");
  });

  it("rejects non-HTML responses", async () => {
    const baseDir = await setupKb();

    await expect(
      fetchPage({
        sourceUrl: "http://example.test/plain.txt",
        baseDir,
        httpGet: async () => ({
          url: "http://example.test/plain.txt",
          status: 200,
          contentType: "text/plain",
          charset: "utf-8",
          body: Buffer.from("not html"),
        }),
        log: () => {},
      }),
    ).rejects.toThrow(/Expected HTML but received text\/plain/);

    const rawEntries = await readdir(join(baseDir, "raw"));
    expect(rawEntries).toHaveLength(0);
  });

  it("skips image downloads that are not image content types", async () => {
    const baseDir = await setupKb();
    const log = vi.fn();

    const result = await fetchPage({
      sourceUrl: PAGE_URL,
      baseDir,
      httpGet: async (url, options) => {
        if (url === PAGE_URL) {
          return {
            url: PAGE_URL,
            status: 200,
            contentType: "text/html",
            charset: "utf-8",
            body: Buffer.from(PAGE_HTML),
          };
        }
        if (url === CSS_URL) {
          expect(options?.accept).toBe(ACCEPT_CSS);
          return {
            url: CSS_URL,
            status: 200,
            contentType: "text/css",
            charset: "utf-8",
            body: Buffer.from("body {}"),
          };
        }
        expect(options?.accept).toBe(ACCEPT_IMAGE);
        return {
          url: IMAGE_URL,
          status: 200,
          contentType: "text/html",
          charset: "utf-8",
          body: Buffer.from("<html>not an image</html>"),
        };
      },
      log,
    });

    expect(result.images).toBe(0);
    expect(result.stylesheets).toBe(1);
    expect(
      log.mock.calls.some(([message]) =>
        message.includes("returned text/html, expected image"),
      ),
    ).toBe(true);
  });
});
