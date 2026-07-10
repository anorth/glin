import { describe, expect, it } from "vitest";
import {
  absolutizeHrefAndSrc,
  cleanHtml,
  collapseBlankLines,
  findLinkedMedia,
  injectOfflineCsp,
  isExecutableScript,
  OFFLINE_ARCHIVE_CSP,
  parseHtml,
  readCanonicalUrl,
  readTitle,
  rewriteImageTags,
  rewriteStylesheetLinks,
  serializeHtml,
  stripExecutableScripts,
} from "./html.js";

const BASE_URL = "http://127.0.0.1:8080/blog/post/";

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head>
<title>Test Article</title>
<link rel="canonical" href="/blog/post/">
</head><body>
<img src="/photo.png" alt="local">
<img src="data:image/png;base64,abc" alt="inline">
<img src="blob:ignored" alt="blob">
<a href="/paper.pdf">PDF</a>
<a href="/clip.mp3">Audio link</a>
<video src="/movie.mp4"></video>
<audio src="/pod.ogg"></audio>
</body></html>`;

describe("readTitle", () => {
  it("reads the document title", () => {
    const root = parseHtml(FIXTURE_HTML);
    expect(readTitle(root)).toBe("Test Article");
  });
});

describe("readCanonicalUrl", () => {
  it("resolves canonical link against base URL", () => {
    const root = parseHtml(FIXTURE_HTML);
    expect(readCanonicalUrl(root, BASE_URL)).toBe(
      "http://127.0.0.1:8080/blog/post/",
    );
  });
});

describe("rewriteImageTags", () => {
  it("rewrites localizable img src and adds data-original-src", async () => {
    const root = parseHtml(FIXTURE_HTML);
    const result = await rewriteImageTags({
      root,
      baseUrl: BASE_URL,
      localize: async () => "images/photo.png",
    });

    expect(result.localizedCount).toBe(1);
    const html = serializeHtml(root);
    expect(html).toContain('src="images/photo.png"');
    expect(html).toContain(
      'data-original-src="http://127.0.0.1:8080/photo.png"',
    );
    expect(html).toContain('src="data:image/png;base64,abc"');
    expect(html.match(/data-original-src/g)?.length).toBe(1);
  });

  it("drops srcset when src is localized so CSP does not load remote candidates", async () => {
    const root = parseHtml(
      '<img src="/photo.png" srcset="/photo-2x.png 2x" sizes="100vw">',
    );
    await rewriteImageTags({
      root,
      baseUrl: BASE_URL,
      localize: async () => "images/photo.png",
    });

    const img = root.querySelector("img");
    expect(img?.getAttribute("src")).toBe("images/photo.png");
    expect(img?.getAttribute("srcset")).toBeUndefined();
    expect(img?.getAttribute("data-original-srcset")).toBe("/photo-2x.png 2x");
    expect(img?.getAttribute("sizes")).toBeUndefined();
  });

  it("strips remote src when localize returns null", async () => {
    const root = parseHtml('<img src="/missing.png">');
    const result = await rewriteImageTags({
      root,
      baseUrl: "http://example.com/",
      localize: async () => null,
    });

    expect(result.localizedCount).toBe(0);
    const img = root.querySelector("img");
    expect(img?.getAttribute("src")).toBeUndefined();
    expect(img?.getAttribute("data-original-src")).toBe(
      "http://example.com/missing.png",
    );
  });

  it("localizes data-src instead of placeholder src", async () => {
    const root = parseHtml(
      '<img src="/placeholder.png" data-src="/real.png" alt="lazy">',
    );
    const result = await rewriteImageTags({
      root,
      baseUrl: BASE_URL,
      localize: async (url) =>
        url.endsWith("/real.png") ? "images/real.png" : null,
    });

    expect(result.localizedCount).toBe(1);
    const img = root.querySelector("img");
    expect(img?.getAttribute("src")).toBe("images/real.png");
    expect(img?.getAttribute("data-src")).toBeUndefined();
    expect(img?.getAttribute("data-original-src")).toBe(
      "http://127.0.0.1:8080/real.png",
    );
  });

  it("strips lazy-load attrs when data-src localization fails", async () => {
    const root = parseHtml(
      '<img src="/placeholder.png" data-src="/missing.png">',
    );
    const result = await rewriteImageTags({
      root,
      baseUrl: BASE_URL,
      localize: async () => null,
    });

    expect(result.localizedCount).toBe(0);
    const img = root.querySelector("img");
    expect(img?.getAttribute("src")).toBeUndefined();
    expect(img?.getAttribute("data-src")).toBeUndefined();
    expect(img?.getAttribute("data-original-src")).toBe(
      "http://127.0.0.1:8080/missing.png",
    );
  });
});

describe("rewriteStylesheetLinks", () => {
  it("rewrites stylesheet link href and adds data-original-href", async () => {
    const root = parseHtml(
      '<link rel="stylesheet" href="/site.css"><link rel="canonical" href="/x">',
    );
    const result = await rewriteStylesheetLinks({
      root,
      baseUrl: BASE_URL,
      localize: async () => "styles/site.css",
    });

    expect(result.localizedCount).toBe(1);
    const html = serializeHtml(root);
    expect(html).toContain('href="styles/site.css"');
    expect(html).toContain(
      `data-original-href="http://127.0.0.1:8080/site.css"`,
    );
    expect(html).toContain('rel="canonical"');
  });
});

describe("injectOfflineCsp", () => {
  it("inserts CSP meta as the first element in head", () => {
    const root = parseHtml("<html><head><title>x</title></head><body></body></html>");
    injectOfflineCsp(root);
    const html = serializeHtml(root);

    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_ARCHIVE_CSP}">`,
    );
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<title>"));
  });

  it("creates head when missing", () => {
    const root = parseHtml("<html><body></body></html>");
    injectOfflineCsp(root);
    const html = serializeHtml(root);

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("<head>");
  });
});

describe("findLinkedMedia", () => {
  it("reports linked PDFs, audio, and video without downloading", () => {
    const root = parseHtml(FIXTURE_HTML);
    const media = findLinkedMedia(root, BASE_URL);

    expect(media).toEqual(
      expect.arrayContaining([
        { url: "http://127.0.0.1:8080/paper.pdf", type: "pdf" },
        { url: "http://127.0.0.1:8080/clip.mp3", type: "audio" },
        { url: "http://127.0.0.1:8080/pod.ogg", type: "audio" },
        { url: "http://127.0.0.1:8080/movie.mp4", type: "video" },
      ]),
    );
    expect(media).toHaveLength(4);
  });
});

describe("isExecutableScript", () => {
  it("treats src, missing type, and JS types as executable", () => {
    expect(isExecutableScript(parseHtml('<script src="/app.js">').querySelector("script")!)).toBe(
      true,
    );
    expect(isExecutableScript(parseHtml("<script>alert(1)</script>").querySelector("script")!)).toBe(
      true,
    );
    expect(isExecutableScript(parseHtml('<script type="">x</script>').querySelector("script")!)).toBe(
      true,
    );
    expect(
      isExecutableScript(
        parseHtml('<script type="text/javascript">x</script>').querySelector("script")!,
      ),
    ).toBe(true);
    expect(
      isExecutableScript(
        parseHtml('<script type="module">import x</script>').querySelector("script")!,
      ),
    ).toBe(true);
  });

  it("treats non-JS script types as data", () => {
    expect(
      isExecutableScript(
        parseHtml('<script type="application/json">{}</script>').querySelector("script")!,
      ),
    ).toBe(false);
    expect(
      isExecutableScript(
        parseHtml('<script type="application/ld+json">{}</script>').querySelector("script")!,
      ),
    ).toBe(false);
    expect(
      isExecutableScript(
        parseHtml('<script type="text/template"><p></script>').querySelector("script")!,
      ),
    ).toBe(false);
  });

  it("treats a non-JS type as data even when src is set, since the browser never fetches it", () => {
    expect(
      isExecutableScript(
        parseHtml('<script type="application/json" src="data.json"></script>').querySelector(
          "script",
        )!,
      ),
    ).toBe(false);
  });
});

describe("stripExecutableScripts", () => {
  it("removes executable scripts but keeps data scripts", () => {
    const root = parseHtml(`<html><body>
<script>plugin()</script>
<script type="application/json" id="__NEXT_DATA__">{"title":"Article"}</script>
<script src="/bundle.js"></script>
</body></html>`);
    expect(stripExecutableScripts(root)).toBe(2);
    const out = serializeHtml(root);
    expect(out).not.toContain("plugin()");
    expect(out).not.toContain("bundle.js");
    expect(out).toContain('type="application/json"');
    expect(out).toContain("__NEXT_DATA__");
  });
});

describe("cleanHtml", () => {
  const BASE = "http://example.test/index/";

  it("removes executable script and style by default and absolutizes href/src", () => {
    const html = `<!DOCTYPE html><html><head>
<title>Index</title>
<style>body { color: red; }</style>
<script>alert(1)</script>
<script type="application/json">{"x":1}</script>
<link rel="stylesheet" href="/site.css">
</head><body>
<a href="/page">Link</a>
<img src="/photo.png">
</body></html>`;

    const { root, title, scriptsStripped, stylesStripped } = cleanHtml(html, {
      omitScripts: true,
      omitStyles: true,
      baseUrl: BASE,
    });
    const out = serializeHtml(root);

    expect(title).toBe("Index");
    expect(scriptsStripped).toBe(1);
    expect(stylesStripped).toBe(1);
    expect(out).not.toContain("alert(1)");
    expect(out).toContain('type="application/json"');
    expect(out).not.toContain("<style");
    expect(out).toContain('href="http://example.test/site.css"');
    expect(out).toContain('href="http://example.test/page"');
    expect(out).toContain('src="http://example.test/photo.png"');
  });

  it("preserves script and style when omit flags are false", () => {
    const html =
      "<html><head><style>x{}</style><script>y</script></head><body></body></html>";
    const { root } = cleanHtml(html, {
      omitScripts: false,
      omitStyles: false,
      baseUrl: BASE,
    });
    const out = serializeHtml(root);

    expect(out).toContain("<style");
    expect(out).toContain("<script");
  });
});

describe("absolutizeHrefAndSrc", () => {
  it("leaves data and mailto URLs unchanged", () => {
    const root = parseHtml(
      '<a href="mailto:a@b.c">x</a><img src="data:image/png;base64,abc">',
    );
    absolutizeHrefAndSrc(root, "http://example.test/");
    const html = serializeHtml(root);
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).toContain('src="data:image/png;base64,abc"');
  });
});

describe("collapseBlankLines", () => {
  it("collapses two or more consecutive newlines to one", () => {
    expect(collapseBlankLines("a\n\n\n\nb")).toBe("a\nb");
    expect(collapseBlankLines("a\n\nb")).toBe("a\nb");
  });

  it("strips trailing spaces on blank lines before collapse", () => {
    expect(collapseBlankLines("a\n   \n   \n   \nb")).toBe("a\nb");
  });

  it("strips mixed trailing tabs and spaces on blank lines", () => {
    expect(collapseBlankLines("a\n \t \n\t \n \t \nb")).toBe("a\nb");
  });

  it("strips trailing whitespace before collapse, not after", () => {
    expect(collapseBlankLines("a\n   \n\n\nb")).toBe("a\nb");
  });

  it("normalizes CRLF and clears whitespace-only lines before collapse", () => {
    expect(collapseBlankLines("a\r\n   \r\n   \r\n   \r\nb")).toBe("a\nb");
    expect(collapseBlankLines("a\r\n\r\n\r\nb")).toBe("a\nb");
  });

  it("clears nbsp-only lines before collapse", () => {
    expect(collapseBlankLines("a\n\u00a0\u00a0\n\u00a0\n\u00a0\nb")).toBe("a\nb");
  });
});
