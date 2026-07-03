import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "./paths.js";

const pkg = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
) as { version: string };

export const GLIN_USER_AGENT = `glin/${pkg.version}`;

export const DEFAULT_TIMEOUT_MS = 30_000;

export const ACCEPT_HTML =
  "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";

export const ACCEPT_IMAGE = "image/*,*/*;q=0.8";

export const ACCEPT_CSS = "text/css,*/*;q=0.8";

export interface HttpResponse {
  url: string;
  status: number;
  contentType: string;
  charset: string;
  body: Buffer;
}

export interface HttpGetOptions {
  timeoutMs?: number;
  accept?: string;
}

export type HttpGetFn = (
  url: string,
  options?: HttpGetOptions,
) => Promise<HttpResponse>;

/** Bare media type before any `;params`, lowercased and trimmed. "" if absent. */
export function parseMediaType(value: string | null | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function parseContentType(header: string | null): {
  mediaType: string;
  charset: string;
} {
  const value = header ?? "application/octet-stream";
  const candidate = parseMediaType(value);
  const mediaType = candidate.split("/").length === 2 ? candidate : "application/octet-stream";

  let charset = "utf-8";
  for (const part of value.split(";").slice(1)) {
    const match = /^charset=(.+)$/i.exec(part.trim());
    if (match?.[1]) {
      charset = match[1].replace(/^["']|["']$/g, "");
      break;
    }
  }

  return { mediaType, charset };
}

export function decodeTextBody(body: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export function isHtmlContentType(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

export function isTextContentType(contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (type.startsWith("text/")) {
    return true;
  }
  return (
    type === "application/json" ||
    type === "application/ld+json" ||
    type === "application/xml"
  );
}

export async function httpGet(
  url: string,
  options: HttpGetOptions = {},
): Promise<HttpResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const accept = options.accept ?? ACCEPT_HTML;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": GLIN_USER_AGENT,
        Accept: accept,
      },
    });

    const rawContentType = response.headers.get("content-type");
    const { mediaType, charset } = parseContentType(rawContentType);
    const body = Buffer.from(await response.arrayBuffer());

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    return {
      url: response.url,
      status: response.status,
      contentType: mediaType,
      charset,
      body,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
