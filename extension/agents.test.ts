import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChildArgs,
  discoverAgents,
  formatAgentList,
  genericAgent,
  parseAgentMarkdown,
  resolveInlineFiles,
  type AgentConfig,
} from "./agents.ts";

const sampleAgentMd = `---
name: example
description: A specialized bundled agent
model: google/gemini-2.5-flash
tools: read, write, bash, ls, grep
contextFiles: false
---

You do a specialized task.
`;

describe("parseAgentMarkdown", () => {
  it("parses a valid agent file", () => {
    const agent = parseAgentMarkdown(sampleAgentMd, "/tmp/example.md");
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("example");
    expect(agent!.description).toContain("specialized");
    expect(agent!.model).toBe("google/gemini-2.5-flash");
    expect(agent!.tools).toEqual(["read", "write", "bash", "ls", "grep"]);
    expect(agent!.contextFiles).toBe(false);
    expect(agent!.loadSkills).toBe(false);
    expect(agent!.systemPrompt).toContain("You do a specialized task.");
  });

  it("returns null without name or description", () => {
    expect(parseAgentMarkdown("---\nname: x\n---\nbody", "/tmp/x.md")).toBeNull();
    expect(
      parseAgentMarkdown("---\ndescription: only\n---\nbody", "/tmp/x.md"),
    ).toBeNull();
  });

  it("defaults isolation knobs", () => {
    const agent = parseAgentMarkdown(
      "---\nname: a\ndescription: d\n---\nbody\n",
      "/tmp/a.md",
    );
    expect(agent!.contextFiles).toBe(false);
    expect(agent!.loadSkills).toBe(false);
    expect(agent!.systemPrompt).toBe("body");
  });

  it("honours explicit YAML booleans", () => {
    const agent = parseAgentMarkdown(
      "---\nname: a\ndescription: d\ncontextFiles: true\nloadSkills: true\n---\nbody\n",
      "/tmp/a.md",
    );
    expect(agent!.contextFiles).toBe(true);
    expect(agent!.loadSkills).toBe(true);
  });
});

describe("genericAgent", () => {
  it("builds a context-aware delegate config", () => {
    const agent = genericAgent();
    expect(agent.name).toBe("generic");
    expect(agent.contextFiles).toBe(true);
    expect(agent.loadSkills).toBe(true);
    expect(agent.systemPrompt).toBe("");
    expect(agent.tools).toBeUndefined();
    expect(agent.model).toBeUndefined();
    expect(agent.filePath).toBeUndefined();
  });

  it("accepts an optional model", () => {
    expect(genericAgent("google/gemini-2.5-flash").model).toBe(
      "google/gemini-2.5-flash",
    );
  });
});

describe("discoverAgents", () => {
  it("loads agents from a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "glin-agents-"));
    writeFileSync(join(dir, "example.md"), sampleAgentMd);
    writeFileSync(join(dir, "readme.txt"), "ignore me");
    writeFileSync(
      join(dir, "broken.md"),
      "---\nname: broken\n---\nno description\n",
    );

    const agents = discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("example");
  });

  it("returns empty for missing directory", () => {
    expect(discoverAgents("/nonexistent/agents-dir")).toEqual([]);
  });

  it("finds no bundled agents when agents/ is empty", () => {
    expect(discoverAgents()).toEqual([]);
  });
});

describe("buildChildArgs", () => {
  const named: AgentConfig = {
    name: "example",
    description: "d",
    model: "google/gemini-2.5-flash",
    tools: ["read", "write", "bash"],
    contextFiles: false,
    loadSkills: false,
    systemPrompt: "You do a specialized task.",
    filePath: "/tmp/example.md",
  };

  const promptPath = "/tmp/glin-subagent-xyz/prompt-example.md";

  it("builds an isolated named-agent invocation", () => {
    const args = buildChildArgs(
      named,
      "Do the specialized thing",
      promptPath,
    );
    expect(args).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      "google/gemini-2.5-flash",
      "--tools",
      "read,write,bash",
      "--exclude-tools",
      "subagent",
      "--no-context-files",
      "--no-skills",
      "--system-prompt",
      promptPath,
      "Task: Do the specialized thing",
    ]);
  });

  it("builds a generic context-aware invocation", () => {
    const args = buildChildArgs(genericAgent(), "Summarize the open threads");
    expect(args).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--exclude-tools",
      "subagent",
      "Task: Summarize the open threads",
    ]);
    expect(args).not.toContain("--no-extensions");
    expect(args).not.toContain("--no-context-files");
    expect(args).not.toContain("--no-skills");
    expect(args).not.toContain("--approve");
    expect(args).not.toContain("--no-approve");
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--tools");
  });

  it("passes model on the generic agent", () => {
    const args = buildChildArgs(
      genericAgent("google/gemini-2.5-flash"),
      "do it",
    );
    expect(args).toContain("--model");
    expect(args).toContain("google/gemini-2.5-flash");
  });

  it("allows context files when contextFiles is true", () => {
    const args = buildChildArgs(
      { ...named, contextFiles: true },
      "do it",
      promptPath,
    );
    expect(args).not.toContain("--no-context-files");
  });

  it("omits model, tools, and prompt flags when unset", () => {
    const args = buildChildArgs(
      {
        ...named,
        model: undefined,
        tools: undefined,
        systemPrompt: "",
      },
      "task",
    );
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--system-prompt");
    expect(args.at(-1)).toBe("Task: task");
  });

  it("inlines files as @args before the task message", () => {
    const args = buildChildArgs(named, "do it", promptPath, [
      "/kb/raw/example.com/post/meta.json",
      "/kb/raw/example.com/post/index.html",
    ]);
    expect(args).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      "google/gemini-2.5-flash",
      "--tools",
      "read,write,bash",
      "--exclude-tools",
      "subagent",
      "--no-context-files",
      "--no-skills",
      "--system-prompt",
      promptPath,
      "@/kb/raw/example.com/post/meta.json",
      "@/kb/raw/example.com/post/index.html",
      "Task: do it",
    ]);
  });
});

describe("resolveInlineFiles", () => {
  it("resolves relative paths under cwd", () => {
    const cwd = mkdtempSync(join(tmpdir(), "glin-inline-"));
    writeFileSync(join(cwd, "a.txt"), "a");
    writeFileSync(join(cwd, "b.txt"), "b");

    const result = resolveInlineFiles(cwd, ["a.txt", "b.txt"]);
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([join(cwd, "a.txt"), join(cwd, "b.txt")]);
  });

  it("accepts absolute paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "glin-inline-"));
    const abs = join(cwd, "a.txt");
    writeFileSync(abs, "a");

    const result = resolveInlineFiles(cwd, [abs]);
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([abs]);
  });

  it("errors when a file is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "glin-inline-"));
    writeFileSync(join(cwd, "a.txt"), "a");

    const result = resolveInlineFiles(cwd, ["a.txt", "missing.txt"]);
    expect(result.files).toEqual([]);
    expect(result.error).toMatch(/missing\.txt/);
  });

  it("returns empty for an empty list", () => {
    expect(resolveInlineFiles("/tmp", [])).toEqual({ files: [] });
  });

  it("errors when a path is a directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "glin-inline-"));
    mkdirSync(join(cwd, "subdir"));

    const result = resolveInlineFiles(cwd, ["subdir"]);
    expect(result.files).toEqual([]);
    expect(result.error).toMatch(/Not a file: subdir/);
  });
});

describe("formatAgentList", () => {
  it("formats agents", () => {
    expect(formatAgentList([])).toBe("none");
    expect(
      formatAgentList([
        {
          name: "example",
          description: "A specialized agent",
          contextFiles: false,
          loadSkills: false,
          systemPrompt: "",
          filePath: "x",
        },
      ]),
    ).toBe("example: A specialized agent");
  });
});
