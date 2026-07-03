import { describe, expect, it } from "vitest";
import {
  decodeTextBody,
  isHtmlContentType,
  isTextContentType,
  parseContentType,
} from "./http.js";

describe("parseContentType", () => {
  it("parses media type and charset", () => {
    expect(parseContentType('text/html; charset="iso-8859-1"')).toEqual({
      mediaType: "text/html",
      charset: "iso-8859-1",
    });
  });

  it("defaults charset to utf-8", () => {
    expect(parseContentType("text/html")).toEqual({
      mediaType: "text/html",
      charset: "utf-8",
    });
  });

  it("handles missing header", () => {
    expect(parseContentType(null)).toEqual({
      mediaType: "application/octet-stream",
      charset: "utf-8",
    });
  });
});

describe("decodeTextBody", () => {
  it("decodes using the declared charset", () => {
    const body = Buffer.from("café", "latin1");
    expect(decodeTextBody(body, "latin1")).toBe("café");
  });

  it("falls back to utf-8 for unknown charsets", () => {
    const body = Buffer.from("hello", "utf8");
    expect(decodeTextBody(body, "not-a-real-charset")).toBe("hello");
  });
});

describe("isHtmlContentType", () => {
  it("accepts html and xhtml", () => {
    expect(isHtmlContentType("text/html")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
  });

  it("rejects non-html types", () => {
    expect(isHtmlContentType("text/plain")).toBe(false);
    expect(isHtmlContentType("application/pdf")).toBe(false);
  });
});

describe("isTextContentType", () => {
  it("accepts text and common structured text types", () => {
    expect(isTextContentType("text/plain")).toBe(true);
    expect(isTextContentType("text/markdown")).toBe(true);
    expect(isTextContentType("application/json")).toBe(true);
    expect(isTextContentType("application/xml")).toBe(true);
  });

  it("rejects binary types", () => {
    expect(isTextContentType("application/pdf")).toBe(false);
    expect(isTextContentType("image/png")).toBe(false);
    expect(isTextContentType("application/octet-stream")).toBe(false);
  });
});
