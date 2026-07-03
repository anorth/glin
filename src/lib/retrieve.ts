import { httpGet as defaultHttpGet, type HttpGetFn, type HttpResponse } from "./http.js";

export interface RetrievePageOptions {
  sourceUrl: string;
  httpGet?: HttpGetFn;
  log?: (message: string) => void;
}

export interface RetrievePageResult {
  sourceUrl: string;
  response: HttpResponse;
}

/** Plain HTTP GET shared by fetch and read — same redirects, user-agent, and URL handling. */
export async function retrievePage(
  options: RetrievePageOptions,
): Promise<RetrievePageResult> {
  const get = options.httpGet ?? defaultHttpGet;
  options.log?.(`Fetching ${options.sourceUrl}`);
  const response = await get(options.sourceUrl);
  return { sourceUrl: options.sourceUrl, response };
}
