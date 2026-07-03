import { parse, type HTMLElement } from "node-html-parser";

const PDF_EXT = /\.pdf(?:$|[?#])/i;
const AUDIO_EXT = /\.(?:mp3|wav|ogg|m4a|aac|flac|opus|weba)(?:$|[?#])/i;
const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v|avi|mkv|ogv)(?:$|[?#])/i;

// node-html-parser re-serializes on toString() — attribute order, quoting, implied
// tags, and whitespace may differ from the wire bytes. That is acceptable here:
// the archive must open in a browser with localized images, not match bytes exactly.
const PARSE_OPTIONS = {
  blockTextElements: {
    script: true,
    noscript: true,
    style: true,
    pre: true,
  },
} as const;

export interface LinkedMediaItem {
  url: string;
  type: "pdf" | "audio" | "video";
}

export function parseHtml(html: string): HTMLElement {
  return parse(html, PARSE_OPTIONS);
}

export function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

export function readTitle(root: HTMLElement): string | null {
  const title = root.querySelector("title")?.text.trim();
  return title || null;
}

export function readCanonicalUrl(
  root: HTMLElement,
  baseUrl: string,
): string | null {
  for (const link of root.querySelectorAll("link[href]")) {
    const rel = link.getAttribute("rel")?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("canonical")) {
      continue;
    }
    const href = link.getAttribute("href");
    if (href) {
      return resolveUrl(href, baseUrl);
    }
  }
  return null;
}

export interface ImageRewriteOptions {
  root: HTMLElement;
  baseUrl: string;
  localize: (absoluteUrl: string) => Promise<string | null>;
}

export interface ImageRewriteResult {
  localizedCount: number;
}

export async function rewriteImageTags(
  options: ImageRewriteOptions,
): Promise<ImageRewriteResult> {
  let localizedCount = 0;

  neutralizePictureSources(options.root);

  for (const img of options.root.querySelectorAll("img")) {
    preserveRemoteImageAttrs(img);

    const primary = primaryImageUrl(img);
    if (!primary) {
      continue;
    }

    const { url, attribute } = primary;

    const absoluteUrl = resolveUrl(url, options.baseUrl);
    const localPath = await options.localize(absoluteUrl);
    if (!localPath) {
      stripRemoteImageSources(img, absoluteUrl, attribute);
      continue;
    }

    applyLocalizedImage(img, absoluteUrl, attribute, localPath);

    localizedCount += 1;
  }

  return { localizedCount };
}

export interface StylesheetRewriteOptions {
  root: HTMLElement;
  baseUrl: string;
  localize: (absoluteUrl: string) => Promise<string | null>;
}

export interface StylesheetRewriteResult {
  localizedCount: number;
}

export async function rewriteStylesheetLinks(
  options: StylesheetRewriteOptions,
): Promise<StylesheetRewriteResult> {
  let localizedCount = 0;

  for (const link of options.root.querySelectorAll("link[href]")) {
    const rel = link.getAttribute("rel")?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("stylesheet")) {
      continue;
    }

    const href = link.getAttribute("href");
    if (!href || !isLocalizableUrl(href)) {
      continue;
    }

    const absoluteUrl = resolveUrl(href, options.baseUrl);
    const localPath = await options.localize(absoluteUrl);
    if (!localPath) {
      continue;
    }

    link.setAttribute("data-original-href", absoluteUrl);
    link.setAttribute("href", localPath);
    localizedCount += 1;
  }

  return { localizedCount };
}

/** CSP applied to archived pages so they open offline without network fetches or script. */
export const OFFLINE_ARCHIVE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  // file:// pages cannot rely on 'self' for sibling paths in Chrome; * allows local images.
  "img-src * data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src http: https: data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Insert an offline-viewing CSP meta tag at the start of head. */
export function injectOfflineCsp(root: HTMLElement): void {
  const metaHtml = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_ARCHIVE_CSP}">`;
  const head = root.querySelector("head");
  if (head) {
    head.insertAdjacentHTML("afterbegin", metaHtml);
    return;
  }

  const html = root.querySelector("html");
  if (html) {
    html.insertAdjacentHTML("afterbegin", `<head>${metaHtml}</head>`);
    return;
  }

  root.insertAdjacentHTML("afterbegin", `<head>${metaHtml}</head>`);
}

export function serializeHtml(root: HTMLElement): string {
  // Serialized output reflects the parser's HTML model, not the original response bytes.
  return root.toString();
}

export function findLinkedMedia(
  root: HTMLElement,
  baseUrl: string,
): LinkedMediaItem[] {
  const items: LinkedMediaItem[] = [];
  const seen = new Set<string>();

  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }
    const absolute = resolveUrl(href, baseUrl);
    const type = classifyLinkedUrl(absolute);
    if (type) {
      addLinkedMedia(items, seen, absolute, type);
    }
  }

  for (const tag of root.querySelectorAll("audio[src], video[src]")) {
    const src = tag.getAttribute("src");
    if (!src) {
      continue;
    }
    const absolute = resolveUrl(src, baseUrl);
    const type = tag.tagName.toLowerCase() === "video" ? "video" : "audio";
    addLinkedMedia(items, seen, absolute, type);
  }

  for (const source of root.querySelectorAll("source[src]")) {
    const src = source.getAttribute("src");
    if (!src) {
      continue;
    }
    const absolute = resolveUrl(src, baseUrl);
    if (AUDIO_EXT.test(absolute)) {
      addLinkedMedia(items, seen, absolute, "audio");
    } else if (VIDEO_EXT.test(absolute)) {
      addLinkedMedia(items, seen, absolute, "video");
    }
  }

  return items;
}

function isLocalizableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return !lower.startsWith("data:") && !lower.startsWith("blob:");
}

const LAZY_IMAGE_ATTRS = ["data-src", "data-lazy-src"] as const;

function primaryImageUrl(img: HTMLElement): { url: string; attribute: string } | null {
  // Lazy-load attrs carry the real URL; src is often a tiny placeholder.
  for (const attribute of [...LAZY_IMAGE_ATTRS, "src"]) {
    const url = img.getAttribute(attribute);
    if (url && isLocalizableUrl(url)) {
      return { url, attribute };
    }
  }
  return null;
}

function applyLocalizedImage(
  img: HTMLElement,
  absoluteUrl: string,
  primaryAttribute: string,
  localPath: string,
): void {
  if (primaryAttribute !== "src") {
    img.removeAttribute(primaryAttribute);
    const placeholderSrc = img.getAttribute("src");
    if (placeholderSrc && isLocalizableUrl(placeholderSrc)) {
      img.removeAttribute("src");
    }
  }

  for (const attribute of LAZY_IMAGE_ATTRS) {
    if (attribute !== primaryAttribute) {
      img.removeAttribute(attribute);
    }
  }

  img.setAttribute("data-original-src", absoluteUrl);
  img.setAttribute("src", localPath);
}

function stripRemoteImageSources(
  img: HTMLElement,
  primaryAbsoluteUrl: string,
  primaryAttribute: string,
): void {
  img.setAttribute("data-original-src", primaryAbsoluteUrl);

  if (primaryAttribute !== "src") {
    img.removeAttribute(primaryAttribute);
  }

  for (const attribute of ["src", ...LAZY_IMAGE_ATTRS]) {
    const url = img.getAttribute(attribute);
    if (url && isLocalizableUrl(url)) {
      img.removeAttribute(attribute);
    }
  }
}

function preserveRemoteImageAttrs(el: HTMLElement): void {
  const srcset = el.getAttribute("srcset");
  if (srcset) {
    el.setAttribute("data-original-srcset", srcset);
    el.removeAttribute("srcset");
  }
  el.removeAttribute("sizes");
}

function neutralizePictureSources(root: HTMLElement): void {
  for (const source of root.querySelectorAll("picture source")) {
    preserveRemoteImageAttrs(source);
    const src = source.getAttribute("src");
    if (src) {
      source.setAttribute("data-original-src", src);
      source.removeAttribute("src");
    }
  }
}

function addLinkedMedia(
  items: LinkedMediaItem[],
  seen: Set<string>,
  url: string,
  type: LinkedMediaItem["type"],
): void {
  if (!url || seen.has(url)) {
    return;
  }
  seen.add(url);
  items.push({ url, type });
}

function classifyLinkedUrl(
  absolute: string,
): LinkedMediaItem["type"] | null {
  if (PDF_EXT.test(absolute)) {
    return "pdf";
  }
  if (AUDIO_EXT.test(absolute)) {
    return "audio";
  }
  if (VIDEO_EXT.test(absolute)) {
    return "video";
  }
  return null;
}
