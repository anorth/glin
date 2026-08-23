import type { Command } from "commander";
import { webSearch } from "../lib/web-search.js";

export function registerWebSearchCommand(program: Command): void {
  program
    .command("web-search")
    .summary("Search the web for candidate sources via Exa (no disk writes)")
    .description(
      `Search the web for candidate source URLs via the Exa API and print ranked
results as JSON to stdout. No knowledge base required; nothing is written to disk.

Results are triage data only — titles, snippets/highlights, and metadata for the
agent to judge. Archive a chosen URL with glin fetch.

Requires EXA_API_KEY in the environment. Progress and cost go to stderr.`,
    )
    .argument("<query>", "Search query")
    .option("--num-results <n>", "Number of results to return (default 20)", "20")
    .option(
      "--include-domain <domain>",
      "Only include results from this domain (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--exclude-domain <domain>",
      "Exclude results from this domain (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--start-published-date <date>",
      "Only results published on or after this date (ISO 8601)",
    )
    .option(
      "--end-published-date <date>",
      "Only results published on or before this date (ISO 8601)",
    )
    .action(
      async (
        query: string,
        options: {
          numResults: string;
          includeDomain: string[];
          excludeDomain: string[];
          startPublishedDate?: string;
          endPublishedDate?: string;
        },
      ) => {
        try {
          const numResults = Number.parseInt(options.numResults, 10);
          if (!Number.isFinite(numResults) || numResults < 1) {
            throw new Error(
              `invalid --num-results: ${options.numResults} (expected a positive integer)`,
            );
          }

          const result = await webSearch({
            query,
            numResults,
            includeDomains:
              options.includeDomain.length > 0
                ? options.includeDomain
                : undefined,
            excludeDomains:
              options.excludeDomain.length > 0
                ? options.excludeDomain
                : undefined,
            startPublishedDate: options.startPublishedDate,
            endPublishedDate: options.endPublishedDate,
          });

          if (result.costDollars != null) {
            console.error(`cost: $${result.costDollars}`);
          }
          console.log(JSON.stringify(result));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown web-search error";
          console.error(`glin web-search: ${message}`);
          process.exitCode = 1;
        }
      },
    );
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat(value);
}
