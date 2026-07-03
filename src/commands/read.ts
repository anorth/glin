import type { Command } from "commander";
import {
  BinaryContentError,
  formatReadMetadata,
  readPage,
} from "../lib/read.js";
import { parseYesNo } from "./options.js";

export function registerReadCommand(program: Command): void {
  program
    .command("read")
    .summary("Fetch a page over HTTP and print cleaned content to stdout (no disk writes)")
    .description(
      `Fetch a page over plain HTTP and print its content to stdout — no disk writes,
no knowledge base required.

Uses the same plain HTTP retrieval as fetch (redirects, user-agent, URL handling).
For HTML, mechanically cleans the document: removes executable <script> and <style> by default
(data scripts such as JSON blocks are always kept),
and resolves relative href/src to absolute URLs against the final URL after redirects.
Other text types (plain text, markdown, JSON) are returned verbatim. Binary responses
(e.g. PDF) are rejected.

Prints cleaned content to stdout. A one-line metadata summary (final URL, content-type,
title) goes to stderr.`,
    )
    .argument("<url>", "URL to read")
    .option(
      "--omit-scripts <yes|no>",
      "Remove executable <script> elements; data scripts (JSON, etc.) are always kept (default yes)",
      "yes",
    )
    .option(
      "--omit-styles <yes|no>",
      "Remove <style> elements (default yes)",
      "yes",
    )
    .action(
      async (
        url: string,
        options: { omitScripts: string; omitStyles: string },
      ) => {
        try {
          const result = await readPage({
            sourceUrl: url,
            omitScripts: parseYesNo(options.omitScripts),
            omitStyles: parseYesNo(options.omitStyles),
          });
          console.error(formatReadMetadata(result));
          process.stdout.write(result.content);
        } catch (error) {
          if (error instanceof BinaryContentError) {
            console.error(
              `glin read: binary content (${error.contentType}) at ${error.url} — read performs no extraction`,
            );
          } else {
            const message =
              error instanceof Error ? error.message : "Unknown read error";
            console.error(`glin read: ${message}`);
          }
          process.exitCode = 1;
        }
      },
    );
}
