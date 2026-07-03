#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerFetchCommand } from "./commands/fetch.js";
import { registerInitCommand } from "./commands/init.js";
import { PACKAGE_ROOT } from "./lib/paths.js";

const pkg = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("glin")
  .description("Build local, LLM-curated knowledge bases")
  .version(pkg.version);

registerFetchCommand(program);
registerInitCommand(program);

program.parse();
