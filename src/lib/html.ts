import { parse, type HTMLElement } from "node-html-parser";
import { parseMediaType } from "./http.js";

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

/**
 * Best-effort publication / site name from common page meta.
 * Order: og:site_name, JSON-LD publisher.name, application-name, publisher.
 * Returns null when none are present (caller should omit the field).
 */
export function readPublication(root: HTMLElement): string | null {
  return (
    readMetaContent(root, "property", "og:site_name") ??
    readJsonLdNamed(root, "publisher") ??
    readMetaContent(root, "name", "application-name") ??
    readMetaContent(root, "name", "publisher")
  );
}

/**
 * Best-effort article author from common page meta.
 * Order: JSON-LD author.name, meta author, article:author, rel=author.
 * Returns null when none are present (caller should omit the field).
 * Skips values that are bare http(s) URLs (common for article:author).
 */
export function readAuthor(root: HTMLElement): string | null {
  return (
    nonUrlName(readJsonLdNamed(root, "author")) ??
    nonUrlName(readMetaContent(root, "name", "author")) ??
    nonUrlName(readMetaContent(root, "property", "article:author")) ??
    nonUrlName(readRelAuthorName(root))
  );
}

/** content= of the first <meta> whose name or property matches (case-insensitive). */
function readMetaContent(
  root: HTMLElement,
  attr: "name" | "property",
  value: string,
): string | null {
  const needle = value.toLowerCase();
  for (const meta of root.querySelectorAll("meta")) {
    const attrValue = meta.getAttribute(attr)?.trim().toLowerCase();
    if (attrValue !== needle) {
      continue;
    }
    const content = meta.getAttribute("content")?.trim();
    if (content) {
      return content;
    }
  }
  return null;
}

/** Visible text of the first <a rel="author">, if any. */
function readRelAuthorName(root: HTMLElement): string | null {
  for (const el of root.querySelectorAll("a[rel]")) {
    const rel = el.getAttribute("rel")?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("author")) {
      continue;
    }
    const text = el.text.trim().replace(/\s+/g, " ");
    if (text) {
      return text;
    }
  }
  return null;
}

/** First usable name from JSON-LD for a property like author or publisher. */
function readJsonLdNamed(
  root: HTMLElement,
  property: "author" | "publisher",
): string | null {
  for (const node of jsonLdObjects(root)) {
    const name = nameFromJsonLdValue(node[property]);
    if (name) {
      return name;
    }
  }
  return null;
}

/** Flatten application/ld+json script bodies into plain objects (@graph expanded). */
function jsonLdObjects(root: HTMLElement): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  for (const el of root.querySelectorAll("script[type]")) {
    const type = el.getAttribute("type")?.trim().toLowerCase() ?? "";
    if (type !== "application/ld+json") {
      continue;
    }
    const raw = el.text.trim();
    if (!raw) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const obj = item as Record<string, unknown>;
      const graph = obj["@graph"];
      if (Array.isArray(graph)) {
        for (const node of graph) {
          if (node && typeof node === "object" && !Array.isArray(node)) {
            objects.push(node as Record<string, unknown>);
          }
        }
      }
      objects.push(obj);
    }
  }
  return objects;
}

/** String | {name} | array → first non-empty name string. */
function nameFromJsonLdValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = nameFromJsonLdValue(item);
      if (name) {
        return name;
      }
    }
    return null;
  }
  if (value && typeof value === "object") {
    const name = (value as Record<string, unknown>).name;
    if (typeof name === "string") {
      const trimmed = name.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

/** Reject bare http(s) URLs; those are not useful as display names. */
function nonUrlName(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return null;
  }
  return value;
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
  return collapseBlankLines(root.toString());
}

/** Collapse runs of blank lines left by parse/serialize round-trips. */
export function collapseBlankLines(html: string): string {
  const normalized = html.replace(/\r\n?/g, "\n");
  const stripped = normalized.replace(/^\s+$/gm, "");
  return stripped.replace(/\n{2,}/g, "\n");
}

export function absolutizeHrefAndSrc(root: HTMLElement, baseUrl: string): void {
  for (const el of root.querySelectorAll("[href], [src]")) {
    for (const attr of ["href", "src"] as const) {
      const value = el.getAttribute(attr);
      if (value && isAbsolutizableUrl(value)) {
        el.setAttribute(attr, resolveUrl(value, baseUrl));
      }
    }
  }
}

const EXECUTABLE_SCRIPT_TYPES = new Set([
  "text/javascript",
  "application/javascript",
  "module",
]);

/** Whether the browser would execute this script element (vs. carry data only). */
export function isExecutableScript(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== "script") {
    return false;
  }
  // The browser's script-processing algorithm gates on type before src: a non-JS
  // type (e.g. application/json) is inert and never fetched or run, src or not.
  const type = parseMediaType(el.getAttribute("type"));
  return type === "" || EXECUTABLE_SCRIPT_TYPES.has(type);
}

/** Remove executable scripts; data scripts (JSON, templates, etc.) are always kept. */
export function stripExecutableScripts(root: HTMLElement): number {
  let count = 0;
  for (const el of [...root.querySelectorAll("script")]) {
    if (isExecutableScript(el)) {
      el.remove();
      count += 1;
    }
  }
  return count;
}

export function stripStyleElements(root: HTMLElement): number {
  let count = 0;
  for (const el of [...root.querySelectorAll("style")]) {
    el.remove();
    count += 1;
  }
  return count;
}

export interface CleanHtmlOptions {
  omitScripts: boolean;
  omitStyles: boolean;
  baseUrl: string;
}

export interface CleanHtmlResult {
  root: HTMLElement;
  title: string | null;
  scriptsStripped: number;
  stylesStripped: number;
}

export function cleanHtml(
  html: string,
  options: CleanHtmlOptions,
): CleanHtmlResult {
  const root = parseHtml(html);
  let scriptsStripped = 0;
  let stylesStripped = 0;
  if (options.omitScripts) {
    scriptsStripped = stripExecutableScripts(root);
  }
  if (options.omitStyles) {
    stylesStripped = stripStyleElements(root);
  }
  absolutizeHrefAndSrc(root, options.baseUrl);
  return { root, title: readTitle(root), scriptsStripped, stylesStripped };
}

function isAbsolutizableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return (
    !lower.startsWith("data:") &&
    !lower.startsWith("blob:") &&
    !lower.startsWith("javascript:") &&
    !lower.startsWith("mailto:") &&
    !lower.startsWith("tel:")
  );
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
