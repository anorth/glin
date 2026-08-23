import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanHtml, findLinkedMedia, injectOfflineCsp, readAuthor, readCanonicalUrl, readPublication, rewriteImageTags, rewriteStylesheetLinks, serializeHtml, type LinkedMediaItem, } from "./html.js";
import { ACCEPT_CSS, ACCEPT_IMAGE, decodeTextBody, httpGet as defaultHttpGet, isHtmlContentType, isPdfContentType, parseMediaType, type HttpGetFn, type HttpResponse, } from "./http.js";
import { requireBaseDir } from "./kb.js";
import { contentHashBasename, resolveHashFilename } from "./hash-filename.js";
import { retrievePage } from "./retrieve.js";
import { extensionFromUrlPath, sanitizeDomain, sanitizePathComponent, slugFromUrl, } from "./sanitize.js";

export interface FetchMeta {
  sourceUrl: string;
  finalUrl: string;
  fetched: string;
  contentType: string;
  title: string | null;
  canonicalUrl: string | null;
  /** Present only when the page exposes a usable author. */
  author?: string;
  /** Present only when the page exposes a usable publication / site name. */
  publication?: string;
  /** Original URL basename for PDF archives (payload is always document.pdf). */
  filename?: string;
  images: number;
  stylesheets: number;
  linkedMedia: LinkedMediaItem[];
  scriptsStripped: number;
  stylesStripped: number;
}

export interface FetchResult extends FetchMeta {
  archivePath: string;
}

export interface FetchOptions {
  sourceUrl: string;
  group?: string;
  baseDir?: string;
  omitScripts?: boolean;
  omitStyles?: boolean;
  log?: (message: string) => void;
  httpGet?: HttpGetFn;
}

// Fetches a page (HTML) or PDF into a raw/ archive, and returns archive metadata
export async function fetchPage(options: FetchOptions): Promise<FetchResult> {
  const kbRoot = requireBaseDir(options.baseDir);
  const log = options.log ?? (() => { });
  const get = options.httpGet ?? defaultHttpGet;

  const { response } = await retrievePage({
    sourceUrl: options.sourceUrl,
    httpGet: get,
    log,
  });

  if (isPdfFetchTarget(response)) {
    return archivePdf({
      kbRoot,
      sourceUrl: options.sourceUrl,
      group: options.group,
      response,
      log,
    });
  }

  if (!isHtmlContentType(response.contentType)) {
    throw new Error(
      `Expected HTML or PDF but received ${response.contentType} from ${response.url}`,
    );
  }

  return archiveHtml({
    kbRoot,
    sourceUrl: options.sourceUrl,
    group: options.group,
    response,
    get,
    log,
    omitScripts: options.omitScripts ?? true,
    omitStyles: options.omitStyles ?? false,
  });
}

async function archivePdf(options: {
  kbRoot: string;
  sourceUrl: string;
  group?: string;
  response: HttpResponse;
  log: (message: string) => void;
}): Promise<FetchResult> {
  const { archiveAbs, archiveRel } = archiveDirectory(
    options.kbRoot,
    options.response.url,
    options.group,
  );

  if (existsSync(archiveAbs)) {
    options.log(`  replacing existing archive at ${archiveRel}`);
  }

  const stagingPath = `${archiveAbs}.tmp-${randomBytes(4).toString("hex")}`;

  try {
    await mkdir(stagingPath, { recursive: true });

    const meta: FetchMeta = {
      sourceUrl: options.sourceUrl,
      finalUrl: options.response.url,
      fetched: new Date().toISOString(),
      contentType: options.response.contentType,
      title: null,
      canonicalUrl: null,
      images: 0,
      stylesheets: 0,
      linkedMedia: [],
      scriptsStripped: 0,
      stylesStripped: 0,
    };
    const filename = originalFilenameFromUrl(options.response.url);
    if (filename) {
      meta.filename = filename;
    }

    await writeFile(join(stagingPath, "document.pdf"), options.response.body);
    await writeFile(
      join(stagingPath, "meta.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8",
    );

    await rm(archiveAbs, { recursive: true, force: true });
    await rename(stagingPath, archiveAbs);

    options.log(`Archived to ${archiveRel}`);

    return { ...meta, archivePath: archiveRel };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

async function archiveHtml(options: {
  kbRoot: string;
  sourceUrl: string;
  group?: string;
  response: HttpResponse;
  get: HttpGetFn;
  log: (message: string) => void;
  omitScripts: boolean;
  omitStyles: boolean;
}): Promise<FetchResult> {
  const html = decodeTextBody(options.response.body, options.response.charset);
  const { archiveAbs, archiveRel } = archiveDirectory(
    options.kbRoot,
    options.response.url,
    options.group,
  );

  if (existsSync(archiveAbs)) {
    options.log(`  replacing existing archive at ${archiveRel}`);
  }

  const stagingPath = `${archiveAbs}.tmp-${randomBytes(4).toString("hex")}`;

  try {
    await mkdir(join(stagingPath, "images"), { recursive: true });
    await mkdir(join(stagingPath, "styles"), { recursive: true });

    const downloaded = new Map<string, string>();

    const imageConfig: AssetLocalizerConfig = {
      subdir: "images",
      accept: ACCEPT_IMAGE,
      logLabel: "image",
      isExpectedContentType: (contentType) => contentType.startsWith("image/"),
      extensionFromContentType: extensionFromImageContentType,
    };

    const stylesheetConfig: AssetLocalizerConfig = {
      subdir: "styles",
      accept: ACCEPT_CSS,
      logLabel: "stylesheet",
      isExpectedContentType: (contentType) => contentType === "text/css",
      extensionFromContentType: () => "css",
    };

    const localizeAsset = createAssetLocalizer({
      stagingPath,
      get: options.get,
      log: options.log,
      downloaded,
    });

    const { root, title, scriptsStripped, stylesStripped } = cleanHtml(html, {
      omitScripts: options.omitScripts,
      omitStyles: options.omitStyles,
      baseUrl: options.response.url,
    });

    const canonicalUrl = readCanonicalUrl(root, options.response.url);
    const author = readAuthor(root);
    const publication = readPublication(root);
    const linkedMedia = findLinkedMedia(root, options.response.url);

    const images = await rewriteImageTags({
      root,
      baseUrl: options.response.url,
      localize: (url) => localizeAsset(url, imageConfig),
    });

    const stylesheets = await rewriteStylesheetLinks({
      root,
      baseUrl: options.response.url,
      localize: (url) => localizeAsset(url, stylesheetConfig),
    });

    injectOfflineCsp(root);

    const meta: FetchMeta = {
      sourceUrl: options.sourceUrl,
      finalUrl: options.response.url,
      fetched: new Date().toISOString(),
      contentType: options.response.contentType,
      title,
      canonicalUrl,
      images: images.localizedCount,
      stylesheets: stylesheets.localizedCount,
      linkedMedia,
      scriptsStripped,
      stylesStripped,
    };
    if (author) {
      meta.author = author;
    }
    if (publication) {
      meta.publication = publication;
    }

    await writeFile(join(stagingPath, "index.html"), serializeHtml(root), "utf8");
    await writeFile(
      join(stagingPath, "meta.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8",
    );

    await rm(archiveAbs, { recursive: true, force: true });
    await rename(stagingPath, archiveAbs);

    options.log(`Archived to ${archiveRel}`);

    return { ...meta, archivePath: archiveRel };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

/** PDF Content-Type, or octet-stream with a .pdf URL path. */
function isPdfFetchTarget(response: HttpResponse): boolean {
  if (isPdfContentType(response.contentType)) {
    return true;
  }
  return (
    parseMediaType(response.contentType) === "application/octet-stream" &&
    extensionFromUrlPath(response.url) === "pdf"
  );
}

/** Decoded final-path basename for meta.filename (not the on-disk document.pdf name). */
function originalFilenameFromUrl(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (!last) {
      return undefined;
    }
    const name = decodeURIComponent(last.split("?")[0] ?? last).trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

interface AssetLocalizerConfig {
  subdir: "images" | "styles";
  accept: string;
  logLabel: string;
  isExpectedContentType: (contentType: string) => boolean;
  extensionFromContentType: (contentType: string) => string | null;
}

// Downloads remote assets and writes them under the staging archive by content hash.
function createAssetLocalizer(options: {
  stagingPath: string;
  get: HttpGetFn;
  log: (message: string) => void;
  downloaded: Map<string, string>;
}): (absoluteUrl: string, config: AssetLocalizerConfig) => Promise<string | null> {
  return async (absoluteUrl, config) => {
    const cached = options.downloaded.get(absoluteUrl);
    if (cached) {
      return cached;
    }

    try {
      options.log(`  ${config.logLabel} ${absoluteUrl}`);
      const assetResponse = await options.get(absoluteUrl, { accept: config.accept });

      if (!config.isExpectedContentType(assetResponse.contentType)) {
        options.log(
          `  warning: ${absoluteUrl} returned ${assetResponse.contentType}, expected ${config.logLabel}`,
        );
        return null;
      }

      const basename = contentHashBasename(
        assetResponse.body,
        extensionFromUrlPath(absoluteUrl) ??
          config.extensionFromContentType(assetResponse.contentType),
      );
      const assetDir = join(options.stagingPath, config.subdir);
      const filename = await resolveHashFilename(assetDir, basename, assetResponse.body);
      const localRelative = `${config.subdir}/${filename}`;
      const localPath = join(assetDir, filename);
      if (!existsSync(localPath)) {
        await writeFile(localPath, assetResponse.body);
      }
      options.downloaded.set(absoluteUrl, localRelative);
      return localRelative;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown ${config.logLabel} download error`;
      options.log(`  warning: failed to download ${config.logLabel} ${absoluteUrl}: ${message}`);
      return null;
    }
  };
}

// Resolves the raw/ directory path for an archived page from its final URL.
function archiveDirectory(
  kbRoot: string,
  finalUrl: string,
  group?: string,
): { archiveAbs: string; archiveRel: string } {
  const url = new URL(finalUrl);
  const domain = sanitizeDomain(url.hostname);
  const slug = slugFromUrl(url);
  const parts = ["raw", domain];
  if (group) {
    parts.push(sanitizePathComponent(group));
  }
  parts.push(slug);
  const archiveRel = parts.join("/");
  return { archiveAbs: join(kbRoot, ...parts), archiveRel };
}

// Maps image media types to conventional file extensions.
function extensionFromImageContentType(contentType: string): string | null {
  switch (parseMediaType(contentType)) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/avif":
      return "avif";
    case "image/bmp":
      return "bmp";
    default:
      return null;
  }
}
