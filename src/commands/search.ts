import type { Command } from "commander";
import {
  DEFAULT_SEARCH_LIMIT,
  formatSearchMarkdown,
  search,
} from "../lib/search.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .summary("Search sources/ and wiki/ for matching concept nodes")
    .description(
      `Search concept nodes under sources/ and wiki/ and print a ranked listing to stdout.

<query> is a single argument — quote it if it contains spaces:
  glin search "effect sizes"

Each whitespace-separated term must appear somewhere in the node (frontmatter or
body). Title, description, tags, and other frontmatter rank above body-only matches.
index.md and log.md are skipped; raw/ and assets/ are not searched.

Default matching is case-insensitive literal substrings. --regex treats the whole
query as one JavaScript regular expression. --case-sensitive applies to both modes.

Default output is a markdown listing (index.md-style bullets with kb-root paths,
matching tags, descriptions, and snippets). --json prints a JSON array of
{ path, title, description, score, snippets, tags } instead. Progress goes to stderr.`,
    )
    .argument("<query>", "Search query (quote if it contains spaces)")
    .option(
      "--limit <n>",
      "Maximum hits to return",
      String(DEFAULT_SEARCH_LIMIT),
    )
    .option("-s, --case-sensitive", "Match case-sensitively")
    .option("-e, --regex", "Treat the query as a JavaScript regular expression")
    .option("--json", "Print hits as a JSON array")
    .action(
      async (
        query: string,
        options: {
          limit: string;
          caseSensitive?: boolean;
          regex?: boolean;
          json?: boolean;
        },
        command,
      ) => {
        try {
          const limit = Number(options.limit);
          if (!Number.isInteger(limit) || limit < 1) {
            throw new Error(
              `invalid --limit: ${options.limit} (expected a positive integer)`,
            );
          }

          const { baseDir } = command.optsWithGlobals() as { baseDir?: string };
          const result = await search({
            query,
            baseDir,
            limit,
            caseSensitive: options.caseSensitive === true,
            regex: options.regex === true,
          });

          const noun = result.hits.length === 1 ? "hit" : "hits";
          console.error(
            `glin search: ${result.hits.length} ${noun} (${result.scanned} files)`,
          );
          if (options.json) {
            console.log(JSON.stringify(result.hits));
          } else {
            console.log(formatSearchMarkdown(result.hits));
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown search error";
          console.error(`glin search: ${message}`);
          process.exitCode = 1;
        }
      },
    );
}
