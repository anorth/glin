import type { Command } from "commander";
import { upgradeKnowledgeBase } from "../lib/stamp.js";

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .summary("Refresh glin-owned content in an existing knowledge base")
    .description(
      `Refresh tool-owned content in an existing knowledge base (default: cwd).

Overwrites .pi/SYSTEM.md and .pi/skills/ from glin's templates, regenerates only
the delimited glin-managed block inside AGENTS.md (human-owned sections above
the markers are left untouched), and refreshes the .pi/extensions/glin symlink.

Requires AGENTS.md with BEGIN/END GLIN markers. Does not touch index.md or
skeleton directories.

Prints a JSON object to stdout with path and refreshed.`,
    )
    .argument("[directory]", "Knowledge base root", ".")
    .action(async (directory: string) => {
      try {
        const result = await upgradeKnowledgeBase(directory);
        console.error(`glin upgrade: refreshed ${result.path}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown upgrade error";
        console.error(`glin upgrade: ${message}`);
        process.exitCode = 1;
      }
    });
}
