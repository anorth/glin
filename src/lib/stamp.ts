import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveBaseDir } from "./kb.js";
import { PACKAGE_ROOT } from "./paths.js";

export const BEGIN_GLIN = "<!-- BEGIN GLIN -->";
export const END_GLIN = "<!-- END GLIN -->";

export type InitResult = {
  path: string;
  created: string[];
  stamped: string[];
};

export type UpgradeResult = {
  path: string;
  refreshed: string[];
};

/** Create a new KB at directory (default cwd). Refuses if .pi/ already exists. */
export async function initKnowledgeBase(directory?: string): Promise<InitResult> {
  const root = resolveBaseDir(directory);
  const piDir = join(root, ".pi");
  if (existsSync(piDir)) {
    throw new Error(
      `.pi/ already exists in ${root}; refusing to init. Use glin upgrade to refresh tool-owned content.`,
    );
  }

  await mkdir(root, { recursive: true });

  const created: string[] = [];
  for (const dir of SKELETON_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
    created.push(`${dir}/`);
  }

  const stamped: string[] = [];

  await mkdir(piDir, { recursive: true });
  created.push(".pi/");

  const systemSrc = join(templatesRoot(), "system-prompt.md");
  const systemDest = join(piDir, "SYSTEM.md");
  await writeFile(systemDest, await readFile(systemSrc));
  stamped.push(".pi/SYSTEM.md");

  const agentsSrc = join(templatesRoot(), "agent-prompt.md");
  const agentsDest = join(root, "AGENTS.md");
  await writeFile(agentsDest, await readFile(agentsSrc));
  stamped.push("AGENTS.md");

  const indexSrc = join(templatesRoot(), "index.md");
  const indexDest = join(root, "index.md");
  await writeFile(indexDest, await readFile(indexSrc));
  stamped.push("index.md");

  stamped.push(...(await stampSkills(root)));
  stamped.push(await linkExtension(root));

  return { path: root, created, stamped };
}

/** Refresh tool-owned content in an existing KB. */
export async function upgradeKnowledgeBase(directory?: string): Promise<UpgradeResult> {
  const root = resolveBaseDir(directory);
  const agentsPath = join(root, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    throw new Error(
      `AGENTS.md not found in ${root}; not a glin knowledge base?`,
    );
  }

  const refreshed: string[] = [];

  await mkdir(join(root, ".pi"), { recursive: true });

  const systemSrc = join(templatesRoot(), "system-prompt.md");
  await writeFile(join(root, ".pi", "SYSTEM.md"), await readFile(systemSrc));
  refreshed.push(".pi/SYSTEM.md");

  const templateAgents = await readFile(
    join(templatesRoot(), "agent-prompt.md"),
    "utf8",
  );
  const managed = extractManagedBlock(templateAgents);
  const existing = await readFile(agentsPath, "utf8");
  await writeFile(agentsPath, replaceManagedBlock(existing, managed));
  refreshed.push("AGENTS.md (managed block)");

  refreshed.push(...(await stampSkills(root)));
  refreshed.push(await linkExtension(root));

  return { path: root, refreshed };
}

const SKELETON_DIRS = ["raw", "sources", "wiki", "assets"] as const;

function templatesRoot(): string {
  return join(PACKAGE_ROOT, "templates");
}

function extensionRoot(): string {
  return join(PACKAGE_ROOT, "extension");
}

async function stampSkills(kbRoot: string): Promise<string[]> {
  const srcSkills = join(templatesRoot(), "skills");
  const destSkills = join(kbRoot, ".pi", "skills");
  await mkdir(destSkills, { recursive: true });
  const names = (await readdir(srcSkills, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const stamped: string[] = [];
  for (const name of names) {
    const dest = join(destSkills, name);
    await cp(join(srcSkills, name), dest, { recursive: true, force: true });
    stamped.push(`.pi/skills/${name}`);
  }
  return stamped;
}

async function linkExtension(kbRoot: string): Promise<string> {
  const extensionsDir = join(kbRoot, ".pi", "extensions");
  await mkdir(extensionsDir, { recursive: true });
  const linkPath = join(extensionsDir, "glin");
  const target = extensionRoot();
  if (!existsSync(target)) {
    throw new Error(`glin extension not found at ${target}`);
  }
  try {
    await unlink(linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
  await symlink(target, linkPath);
  return ".pi/extensions/glin";
}

/** Extract the delimited glin-managed block (markers inclusive) from AGENTS.md text. */
function extractManagedBlock(text: string): string {
  const start = text.indexOf(BEGIN_GLIN);
  const end = text.indexOf(END_GLIN);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `missing ${BEGIN_GLIN} … ${END_GLIN} markers`,
    );
  }
  return text.slice(start, end + END_GLIN.length);
}

/** Replace the managed block in AGENTS.md text; human-owned content outside markers is preserved. */
function replaceManagedBlock(text: string, block: string): string {
  const start = text.indexOf(BEGIN_GLIN);
  const end = text.indexOf(END_GLIN);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `AGENTS.md missing ${BEGIN_GLIN} … ${END_GLIN} markers; cannot upgrade managed block`,
    );
  }
  return text.slice(0, start) + block + text.slice(end + END_GLIN.length);
}
