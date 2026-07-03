import type { Command } from "commander";
import { fetchPage } from "../lib/fetch.js";

export function registerFetchCommand(program: Command): void {
  program
    .command("fetch")
    .summary("Fetch a web page over plain HTTP and archive it under raw/")
    .description(
      `Fetch a web page over plain HTTP and archive it faithfully under raw/.

Downloads HTML as delivered — no headless browser, no JavaScript — and writes:
  raw/<domain>/[<group>/]<slug>/
    index.html   page HTML with localized <img> and stylesheet references
    images/      downloaded image assets
    styles/      downloaded stylesheet assets
    meta.json    fetch record (same fields as stdout, without archive_path)

Each localized <img> gets a data-original-src attribute; each localized stylesheet
<link> gets data-original-href. A Content-Security-Policy meta tag is inserted at the
start of head to block script and most network access when opening locally (styles from
self, fonts from the network). Script, srcset, and linked PDF/audio/video tags are
otherwise left as-is; linked media is reported but not downloaded.

Prints a JSON object to stdout (progress to stderr) with source_url, final_url,
fetched timestamp, content_type, title, canonical_url, images (count localized),
stylesheets (count localized), linked_media, and archive_path.`,
    )
    .argument("<url>", "URL to fetch")
    .option("-g, --group <name>", "Optional grouping subdirectory under the domain")
    .action(async (url: string, options: { group?: string }, command) => {
      try {
        const { baseDir } = command.optsWithGlobals() as { baseDir?: string };
        const result = await fetchPage({
          sourceUrl: url,
          group: options.group,
          baseDir,
          log: (message) => console.error(message),
        });
        console.log(JSON.stringify(result));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown fetch error";
        console.error(`glin fetch: ${message}`);
        process.exitCode = 1;
      }
    });
}
