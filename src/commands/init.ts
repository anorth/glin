import type { Command } from "commander";
import { initKnowledgeBase } from "../lib/stamp.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .summary("Initialize a new knowledge base")
    .description(
      `Initialize a new knowledge base at the given directory (default: cwd).

Creates the KB skeleton (raw/ sources/ wiki/ assets/), stamps AGENTS.md,
index.md, .pi/SYSTEM.md, and .pi/skills/ from glin's templates, and symlinks
.pi/extensions/glin to the installed glin extension.

Refuses if .pi/ already exists — use glin upgrade to refresh tool-owned content.
Does not run git init. AGENTS.md placeholders are left for you to fill in.

Prints a JSON object to stdout with path, created, and stamped.`,
    )
    .argument("[directory]", "Target directory", ".")
    .action(async (directory: string) => {
      try {
        const result = await initKnowledgeBase(directory);
        console.error(`glin init: created knowledge base at ${result.path}`);
        console.error(`Edit AGENTS.md to describe your knowledge base`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown init error";
        console.error(`glin init: ${message}`);
        process.exitCode = 1;
      }
    });
}
