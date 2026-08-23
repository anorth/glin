import { cleanHtml, serializeHtml } from "./html.js";
import {
  decodeTextBody,
  isHtmlContentType,
  isTextContentType,
  type HttpGetFn,
} from "./http.js";
import { retrievePage } from "./retrieve.js";

export class BinaryContentError extends Error {
  readonly contentType: string;
  readonly url: string;

  constructor(contentType: string, url: string) {
    super(`binary content (${contentType})`);
    this.name = "BinaryContentError";
    this.contentType = contentType;
    this.url = url;
  }
}

export interface ReadPageOptions {
  sourceUrl: string;
  omitScripts?: boolean;
  omitStyles?: boolean;
  httpGet?: HttpGetFn;
}

export interface ReadPageResult {
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  title: string | null;
  content: string;
}

export async function readPage(options: ReadPageOptions): Promise<ReadPageResult> {
  const { response } = await retrievePage({
    sourceUrl: options.sourceUrl,
    httpGet: options.httpGet,
  });

  const contentType = response.contentType;

  if (!isHtmlContentType(contentType) && !isTextContentType(contentType)) {
    throw new BinaryContentError(contentType, response.url);
  }

  const text = decodeTextBody(response.body, response.charset);

  if (isHtmlContentType(contentType)) {
    const { root, title } = cleanHtml(text, {
      omitScripts: options.omitScripts ?? true,
      omitStyles: options.omitStyles ?? true,
      baseUrl: response.url,
    });
    return {
      sourceUrl: options.sourceUrl,
      finalUrl: response.url,
      contentType: contentType,
      title,
      content: serializeHtml(root),
    };
  }

  return {
    sourceUrl: options.sourceUrl,
    finalUrl: response.url,
    contentType: contentType,
    title: null,
    content: text,
  };
}

export function formatReadMetadata(result: ReadPageResult): string {
  const redirect =
    result.sourceUrl !== result.finalUrl
      ? ` (from ${result.sourceUrl})`
      : "";
  const titlePart = result.title !== null ? ` title: ${result.title}` : "";
  return `finalUrl: ${result.finalUrl}${redirect} contentType: ${result.contentType}${titlePart}`;
}
