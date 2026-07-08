import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChildArgs,
  discoverAgents,
  formatAgentList,
  parseAgentMarkdown,
  resolveInlineFiles,
  type AgentConfig,
} from "./agents.ts";

const sampleAgentMd = `---
name: extract
description: Turn a raw/ archive into a sources/ node
model: google/gemini-2.5-flash
tools: read, write, bash, ls, grep
replaceSystemPrompt: true
contextFiles: false
---

You extract one archived web page.
`;

describe("parseAgentMarkdown", () => {
  it("parses a valid agent file", () => {
    const agent = parseAgentMarkdown(sampleAgentMd, "/tmp/extract.md");
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("extract");
    expect(agent!.description).toContain("raw/");
    expect(agent!.model).toBe("google/gemini-2.5-flash");
    expect(agent!.tools).toEqual(["read", "write", "bash", "ls", "grep"]);
    expect(agent!.replaceSystemPrompt).toBe(true);
    expect(agent!.contextFiles).toBe(false);
    expect(agent!.systemPrompt).toContain("You extract one archived web page.");
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
    expect(agent!.replaceSystemPrompt).toBe(true);
    expect(agent!.contextFiles).toBe(false);
  });

  it("honours explicit YAML booleans", () => {
    const agent = parseAgentMarkdown(
      "---\nname: a\ndescription: d\nreplaceSystemPrompt: false\ncontextFiles: true\n---\nbody\n",
      "/tmp/a.md",
    );
    expect(agent!.replaceSystemPrompt).toBe(false);
    expect(agent!.contextFiles).toBe(true);
  });

});

describe("discoverAgents", () => {
  it("loads agents from a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "glin-agents-"));
    writeFileSync(join(dir, "extract.md"), sampleAgentMd);
    writeFileSync(join(dir, "readme.txt"), "ignore me");
    writeFileSync(
      join(dir, "broken.md"),
      "---\nname: broken\n---\nno description\n",
    );

    const agents = discoverAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("extract");
  });

  it("returns empty for missing directory", () => {
    expect(discoverAgents("/nonexistent/agents-dir")).toEqual([]);
  });

  it("loads the shipped extract agent when no dir is given", () => {
    const agents = discoverAgents();
    expect(agents.map((a) => a.name)).toContain("extract");
    const extract = agents.find((a) => a.name === "extract")!;
    expect(extract.model).toBeTruthy();
    expect(extract.replaceSystemPrompt).toBe(true);
    expect(extract.contextFiles).toBe(false);
    expect(extract.systemPrompt).toContain("faithful");
  });
});

describe("buildChildArgs", () => {
  const base: AgentConfig = {
    name: "extract",
    description: "d",
    model: "google/gemini-2.5-flash",
    tools: ["read", "write", "bash"],
    replaceSystemPrompt: true,
    contextFiles: false,
    systemPrompt: "You extract pages.",
    filePath: "/tmp/extract.md",
  };

  const promptPath = "/tmp/glin-subagent-xyz/prompt-extract.md";

  it("builds an isolated child invocation with prompt file path", () => {
    const args = buildChildArgs(
      base,
      "Extract raw/example.com/post",
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
      "--no-context-files",
      "--no-skills",
      "--no-extensions",
      "--no-approve",
      "--system-prompt",
      promptPath,
      "Task: Extract raw/example.com/post",
    ]);
  });

  it("appends system prompt when replaceSystemPrompt is false", () => {
    const args = buildChildArgs(
      { ...base, replaceSystemPrompt: false },
      "do it",
      promptPath,
    );
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain(promptPath);
    expect(args).not.toContain("--system-prompt");
  });

  it("allows context files when contextFiles is true", () => {
    const args = buildChildArgs(
      { ...base, contextFiles: true },
      "do it",
      promptPath,
    );
    expect(args).not.toContain("--no-context-files");
  });

  it("omits model, tools, and prompt flags when unset", () => {
    const args = buildChildArgs(
      {
        ...base,
        model: undefined,
        tools: undefined,
        systemPrompt: "",
      },
      "task",
    );
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--append-system-prompt");
    expect(args.at(-1)).toBe("Task: task");
  });

  it("inlines files as @args before the task message", () => {
    const args = buildChildArgs(base, "do it", promptPath, [
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
      "--no-context-files",
      "--no-skills",
      "--no-extensions",
      "--no-approve",
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
          name: "extract",
          description: "Turn raw into sources",
          replaceSystemPrompt: true,
          contextFiles: false,
          systemPrompt: "",
          filePath: "x",
        },
      ]),
    ).toBe("extract: Turn raw into sources");
  });
});
