import type { Command } from "commander";
import { reindex } from "../lib/reindex.js";

export function registerReindexCommand(program: Command): void {
  program
    .command("index")
    .alias("reindex")
    .summary("Regenerate index.md navigation files from frontmatter")
    .description(
      `Regenerate index.md navigation files from concept frontmatter.

Walks sources/ and wiki/ bottom-up, plus the KB-root index.md. Each directory
gets a flat alphabetical listing of child concepts and child subdirectories:

  * [Title](<child.md>) - description
  * [subdir](<subdir/>) - first prose line from that subdir's index.md

glin fully owns the listings: they are regenerated on every run. Prose above the
listing (a directory self-description) is preserved; the first prose line rolls
up into the parent listing. Root index.md keeps only okf_version; other indexes
have no frontmatter. raw/ and assets/ are not indexed. Empty directories get no
index.md.`,
    )
    .action(async (_options, command) => {
      try {
        const { baseDir } = command.optsWithGlobals() as { baseDir?: string };
        await reindex({
          baseDir,
          log: (message) => console.error(`glin index: ${message}`),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown index error";
        console.error(`glin index: ${message}`);
        process.exitCode = 1;
      }
    });
}
