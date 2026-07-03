#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerFetchCommand } from "./commands/fetch.js";
import { registerInitCommand } from "./commands/init.js";
import { registerReadCommand } from "./commands/read.js";
import { PACKAGE_ROOT } from "./lib/paths.js";

const pkg = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("glin")
  .description("Build local, LLM-curated knowledge bases")
  .version(pkg.version)
  .option(
    "-b, --base-dir <dir>",
    "Knowledge base root containing raw/ (default: current working directory)",
  );

registerFetchCommand(program);
registerReadCommand(program);
registerInitCommand(program);

program.parse();
