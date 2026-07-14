import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanHtml, findLinkedMedia, injectOfflineCsp, readAuthor, readCanonicalUrl, readPublication, rewriteImageTags, rewriteStylesheetLinks, serializeHtml, type LinkedMediaItem, } from "./html.js";
import { ACCEPT_CSS, ACCEPT_IMAGE, decodeTextBody, httpGet as defaultHttpGet, isHtmlContentType, parseMediaType, type HttpGetFn, } from "./http.js";
import { requireBaseDir } from "./kb.js";
import { contentHashBasename, resolveHashFilename } from "./hash-filename.js";
import { retrievePage } from "./retrieve.js";
import { extensionFromUrlPath, sanitizeDomain, sanitizePathComponent, slugFromUrl, } from "./sanitize.js";

export interface FetchMeta {
  source_url: string;
  final_url: string;
  fetched: string;
  content_type: string;
  title: string | null;
  canonical_url: string | null;
  /** Present only when the page exposes a usable author. */
  author?: string;
  /** Present only when the page exposes a usable publication / site name. */
  publication?: string;
  images: number;
  stylesheets: number;
  linked_media: LinkedMediaItem[];
  scripts_stripped: number;
  styles_stripped: number;
}

export interface FetchResult extends FetchMeta {
  archive_path: string;
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

// Fetches a page and linked assets into a raw/ archive, and return archive metadata
export async function fetchPage(options: FetchOptions): Promise<FetchResult> {
  const kbRoot = requireBaseDir(options.baseDir);
  const log = options.log ?? (() => { });
  const get = options.httpGet ?? defaultHttpGet;

  const { response } = await retrievePage({
    sourceUrl: options.sourceUrl,
    httpGet: get,
    log,
  });

  if (!isHtmlContentType(response.contentType)) {
    throw new Error(
      `Expected HTML but received ${response.contentType} from ${response.url}`,
    );
  }

  const html = decodeTextBody(response.body, response.charset);
  const { archivePath, archiveRel } = archiveDirectory(
    kbRoot,
    response.url,
    options.group,
  );

  if (existsSync(archivePath)) {
    log(`  replacing existing archive at ${archiveRel}`);
  }

  const stagingPath = `${archivePath}.tmp-${randomBytes(4).toString("hex")}`;

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

    const localizeAsset = createAssetLocalizer({ stagingPath, get, log, downloaded });

    const { root, title, scriptsStripped, stylesStripped } = cleanHtml(html, {
      omitScripts: options.omitScripts ?? true,
      omitStyles: options.omitStyles ?? false,
      baseUrl: response.url,
    });

    const canonical_url = readCanonicalUrl(root, response.url);
    const author = readAuthor(root);
    const publication = readPublication(root);
    const linked_media = findLinkedMedia(root, response.url);

    const images = await rewriteImageTags({
      root,
      baseUrl: response.url,
      localize: (url) => localizeAsset(url, imageConfig),
    });

    const stylesheets = await rewriteStylesheetLinks({
      root,
      baseUrl: response.url,
      localize: (url) => localizeAsset(url, stylesheetConfig),
    });

    injectOfflineCsp(root);

    const meta: FetchMeta = {
      source_url: options.sourceUrl,
      final_url: response.url,
      fetched: new Date().toISOString(),
      content_type: response.contentType,
      title,
      canonical_url,
      images: images.localizedCount,
      stylesheets: stylesheets.localizedCount,
      linked_media,
      scripts_stripped: scriptsStripped,
      styles_stripped: stylesStripped,
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

    await rm(archivePath, { recursive: true, force: true });
    await rename(stagingPath, archivePath);

    log(`Archived to ${archiveRel}`);

    return { ...meta, archive_path: archiveRel };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
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
): { archivePath: string; archiveRel: string } {
  const url = new URL(finalUrl);
  const domain = sanitizeDomain(url.hostname);
  const slug = slugFromUrl(url);
  const parts = ["raw", domain];
  if (group) {
    parts.push(sanitizePathComponent(group));
  }
  parts.push(slug);
  const archiveRel = parts.join("/");
  return { archivePath: join(kbRoot, ...parts), archiveRel };
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
