// Bundled agent discovery and child-process argv construction.
// Agents live next to this module under agents/*.md — not in the KB's .pi/agents/.
// The default (unnamed) subagent is a generic context-aware delegate; named
// agents are optional specializations discovered from agents/.

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  // When true, allow AGENTS.md context files.
  contextFiles: boolean;
  // When true, allow KB skill discovery.
  loadSkills: boolean;
  // If non-empty, passed via `--system-prompt` to the child pi, replacing the
  // default / project SYSTEM.md. Empty means no override (generic delegate).
  systemPrompt: string;
  // Absolute path to the agent's markdown file; unset for the built-in generic agent.
  filePath?: string;
}

type AgentFrontmatter = Record<string, unknown>;

// Built-in generic delegate: no bundled prompt; AGENTS.md + KB skills; default
// tools including other extension tools (e.g. extract). SYSTEM.md loads only when
// the project is already trusted (same as the parent). Excludes the subagent tool
// to avoid nested subagent recursion.
export function genericAgent(model?: string): AgentConfig {
  return {
    name: "generic",
    description: "Context-aware delegate with AGENTS.md and KB skills (SYSTEM.md if trusted)",
    model,
    contextFiles: true,
    loadSkills: true,
    systemPrompt: "",
  };
}

// Load all valid agent definitions from a directory (defaults to bundled agents/).
export function discoverAgents(agentsDir?: string): AgentConfig[] {
  const dir =
    agentsDir ?? join(dirname(fileURLToPath(import.meta.url)), "agents");
  if (!existsSync(dir)) {
    return [];
  }

  const agents: AgentConfig[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) {
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    const filePath = join(dir, entry.name);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const agent = parseAgentMarkdown(content, filePath);
    if (agent) {
      agents.push(agent);
    }
  }

  return agents;
}

export function formatAgentList(agents: AgentConfig[]): string {
  if (agents.length === 0) {
    return "none";
  }
  return agents.map((a) => `${a.name}: ${a.description}`).join("; ");
}

// Build argv for a child `pi` process.
//
// `promptFilePath` is a temp file containing the agent system prompt (Pi's
// resolvePromptInput reads existing paths as file contents).
//
// `inlineFiles` are absolute paths passed to the child as `@<file>` arguments.
// Pi inlines their full contents verbatim into the initial user message,
// bypassing the read tool's size cap (50KB / 2000 lines).
//
// Always passes `--exclude-tools subagent` so the child can use other extension
// tools (e.g. extract) without nested subagent recursion. Other isolation knobs
// follow AgentConfig (generic vs named). Does not pass `--approve` / `--no-approve`:
// the child inherits the project's saved trust decision in the same cwd.
export function buildChildArgs(
  agent: AgentConfig,
  task: string,
  promptFilePath?: string,
  inlineFiles?: string[],
): string[] {
  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  if (agent.model) {
    args.push("--model", agent.model);
  }
  if (agent.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  // Keep extension tools (extract, etc.); only block nested subagent calls.
  args.push("--exclude-tools", "subagent");

  if (!agent.contextFiles) {
    args.push("--no-context-files");
  }

  if (!agent.loadSkills) {
    args.push("--no-skills");
  }

  if (promptFilePath) {
    args.push("--system-prompt", promptFilePath);
  }

  for (const file of inlineFiles ?? []) {
    args.push(`@${file}`);
  }

  args.push(`Task: ${task}`);
  return args;
}

export interface ResolveInlineFilesResult {
  files: string[];
  error?: string;
}

// Resolve caller-supplied paths to absolute files under `cwd`.
// Relative paths are joined with `cwd`; absolute paths are used as-is.
// Fails if any path is missing or not a regular file.
export function resolveInlineFiles(
  cwd: string,
  paths: string[],
): ResolveInlineFilesResult {
  const files: string[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : join(cwd, p);
    if (!existsSync(abs)) {
      return { files: [], error: `File not found: ${p}` };
    }
    if (!statSync(abs).isFile()) {
      return { files: [], error: `Not a file: ${p}` };
    }
    files.push(abs);
  }
  return { files };
}

// Parse a single agent markdown file into an AgentConfig, or null if invalid.
// Visible for testing.
export function parseAgentMarkdown(
  content: string,
  filePath: string,
): AgentConfig | null {
  const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
  const name = asNonEmptyString(frontmatter.name);
  const description = asNonEmptyString(frontmatter.description);
  if (!name || !description) {
    return null;
  }

  return {
    name,
    description,
    tools: parseTools(frontmatter.tools),
    model: asNonEmptyString(frontmatter.model),
    // Named agents default to isolated (no context files / no skills) unless
    // frontmatter opts in — room to specialize later without changing the generic path.
    contextFiles: asBoolean(frontmatter.contextFiles, false),
    loadSkills: asBoolean(frontmatter.loadSkills, false),
    systemPrompt: body.trim(),
    filePath,
  };
}

function asBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function parseTools(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const tools = value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  if (Array.isArray(value)) {
    const tools = value.map(String).map((t) => t.trim()).filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  return undefined;
}
