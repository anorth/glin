import { describe, expect, it } from "vitest";
import {
  extensionFromUrlPath,
  filenameFromUrlPath,
  sanitizeDomain,
  sanitizeFilename,
  sanitizePathComponent,
  slugFromUrl,
  uniquifyFilename,
} from "./sanitize.js";

describe("sanitizeDomain", () => {
  it("strips www and lowercases", () => {
    expect(sanitizeDomain("WWW.Example.COM")).toBe("example.com");
  });
});

describe("sanitizePathComponent", () => {
  it("replaces unsafe characters with hyphens", () => {
    expect(sanitizePathComponent("hello world!")).toBe("hello-world");
  });

  it("returns unnamed for empty input", () => {
    expect(sanitizePathComponent("!!!")).toBe("unnamed");
  });
});

describe("slugFromUrl", () => {
  it("uses index for root path", () => {
    expect(slugFromUrl(new URL("https://example.com/"))).toBe("index");
  });

  it("joins path segments with hyphens", () => {
    expect(slugFromUrl(new URL("https://example.com/blog/my-post/"))).toBe(
      "blog-my-post",
    );
  });
});

describe("sanitizeFilename", () => {
  it("preserves extension", () => {
    expect(sanitizeFilename("photo.PNG")).toBe("photo.png");
  });

  it("returns file for empty name", () => {
    expect(sanitizeFilename("   ")).toBe("file");
  });
});

describe("extensionFromUrlPath", () => {
  it("returns the extension from the final path segment", () => {
    expect(extensionFromUrlPath("https://example.com/a/b/photo.jpg")).toBe("jpg");
    expect(extensionFromUrlPath("https://example.com/x.png?w=100")).toBe("png");
  });

  it("returns null when the URL has no extension", () => {
    expect(extensionFromUrlPath("https://example.com/image")).toBeNull();
    expect(extensionFromUrlPath("https://example.com/")).toBeNull();
  });
});

describe("filenameFromUrlPath", () => {
  it("uses only the final path segment", () => {
    expect(filenameFromUrlPath("https://cdn.example.com/a/b/photo.jpg", "image-1")).toBe(
      "photo.jpg",
    );
  });

  it("strips query strings from the segment", () => {
    expect(filenameFromUrlPath("https://example.com/x.png?w=100", "image-1")).toBe("x.png");
  });

  it("falls back when the URL has no segment", () => {
    expect(filenameFromUrlPath("https://example.com/", "image-1")).toBe("image-1");
  });
});

describe("uniquifyFilename", () => {
  it("returns the first use unchanged and suffixes later uses", () => {
    const used = new Map<string, number>();
    expect(uniquifyFilename("photo.png", used)).toBe("photo.png");
    expect(uniquifyFilename("photo.png", used)).toBe("photo-2.png");
  });
});
