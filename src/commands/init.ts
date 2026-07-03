import type { Command } from "commander";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new knowledge base")
    .argument("[directory]", "Target directory", ".")
    .action(async (_directory: string) => {
      console.error("glin init: not implemented yet");
      process.exitCode = 1;
    });
}
