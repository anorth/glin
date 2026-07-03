import type { Command } from "commander";

export function registerFetchCommand(program: Command): void {
  program
    .command("fetch")
    .description("Download and archive a page faithfully to raw/")
    .argument("<url>", "URL to fetch")
    .action(async (_url: string) => {
      console.error("glin fetch: not implemented yet");
      process.exitCode = 1;
    });
}
