/**
 * glin Pi extension — extract tool + minimal subagent runner.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { type ExtensionAPI, getMarkdownTheme, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";

import { buildChildArgs, discoverAgents, formatAgentList, resolveInlineFiles, type AgentConfig } from "./agents.ts";
import { registerExtractTool } from "./extract.ts";

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

interface SingleResult {
  agent: string;
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

interface SubagentDetails {
  results: SingleResult[];
}


const SubagentParams = Type.Object({
  agent: Type.String({
    description: "Name of the bundled agent to invoke",
  }),
  task: Type.String({
    description: "Task for the agent.",
  }),
  files: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Paths (relative to the working directory, or absolute) whose full contents are inlined into the agent's context.",
    }),
  ),
});

export default function (pi: ExtensionAPI): void {
  registerExtractTool(pi);

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate a task to a specialized glin subagent with an isolated context and (usually) a pinned model.",
      "Available agents are discovered from the extension's bundled agents/ directory.",
      "Optional files are inlined in full into the agent's context.",
    ].join(" "),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agents = discoverAgents();
      const agent = agents.find((a) => a.name === params.agent);

      if (!agent) {
        const available = formatAgentList(agents);
        return {
          content: [
            {
              type: "text",
              text: `Unknown agent: "${params.agent}". Available agents: ${available}`,
            },
          ],
          details: { results: [] },
          isError: true,
        };
      }

      let inlineFiles: string[] = [];
      if (params.files && params.files.length > 0) {
        const resolved = resolveInlineFiles(ctx.cwd, params.files);
        if (resolved.error) {
          return {
            content: [{ type: "text", text: resolved.error }],
            details: { results: [] },
            isError: true,
          };
        }
        inlineFiles = resolved.files;
      }

      const result = await runSingleAgent(
        ctx.cwd,
        agent,
        params.task,
        inlineFiles,
        signal,
        onUpdate,
      );

      if (isFailedResult(result)) {
        return {
          content: [
            {
              type: "text",
              text: `Agent ${result.stopReason || "failed"}: ${getResultOutput(result)}`,
            },
          ],
          details: { results: [result] },
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: getFinalOutput(result.messages) || "(no output)",
          },
        ],
        details: { results: [result] },
      };
    },

    renderCall(args, theme) {
      const agentName = args.agent || "...";
      const preview = args.task
        ? args.task.length > 60
          ? `${args.task.slice(0, 60)}...`
          : args.task
        : "...";
      const files = args.files as string[] | undefined;
      const filesNote =
        files && files.length > 0
          ? `\n  ${theme.fg("dim", `+${files.length} file${files.length > 1 ? "s" : ""}`)}`
          : "";
      const text =
        theme.fg("toolTitle", theme.bold("subagent ")) +
        theme.fg("accent", agentName) +
        `\n  ${theme.fg("dim", preview)}` +
        filesNote;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as SubagentDetails | undefined;
      if (!details || details.results.length === 0) {
        const text = result.content[0];
        return new Text(
          text?.type === "text" ? text.text : "(no output)",
          0,
          0,
        );
      }

      const r = details.results[0];
      const failed = isFailedResult(r);
      const icon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const displayItems = getDisplayItems(r.messages);
      const finalOutput = getFinalOutput(r.messages);
      const mdTheme = getMarkdownTheme();

      if (expanded) {
        const container = new Container();
        let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`;
        if (failed && r.stopReason) {
          header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
        }
        container.addChild(new Text(header, 0, 0));
        if (failed && r.errorMessage) {
          container.addChild(
            new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
          );
        }
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
        container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
        if (displayItems.length === 0 && !finalOutput) {
          container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
        } else {
          for (const item of displayItems) {
            if (item.type === "toolCall") {
              container.addChild(
                new Text(
                  theme.fg("muted", "→ ") +
                  formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                  0,
                  0,
                ),
              );
            }
          }
          if (finalOutput) {
            container.addChild(new Spacer(1));
            container.addChild(
              new Markdown(finalOutput.trim(), 0, 0, mdTheme),
            );
          }
        }
        const usageStr = formatUsageStats(r.usage, r.model);
        if (usageStr) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
        }
        return container;
      }

      let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`;
      if (failed && r.stopReason) {
        text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
      }
      if (failed && r.errorMessage) {
        text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
      } else if (!finalOutput && displayItems.length === 0) {
        text += `\n${theme.fg("muted", "(no output)")}`;
      } else if (finalOutput) {
        const lines = finalOutput.trim().split("\n");
        const preview = lines.slice(0, 3).join("\n");
        text += `\n${theme.fg("toolOutput", preview)}`;
      }
      const hasMore =
        displayItems.length > 0 ||
        (finalOutput ? finalOutput.trim().split("\n").length > 3 : false);
      if (hasMore) {
        text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
      }
      const usageStr = formatUsageStats(r.usage, r.model);
      if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
      return new Text(text, 0, 0);
    },
  });
}

/**
 * Resolve how to invoke `pi` as a child process.
 * Prefer re-executing the current pi binary; fall back to `pi` on PATH.
 */
// Visible for testing
export function getPiInvocation(args: string[]): {
  command: string;
  args: string[];
} {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

async function writePromptToTempFile(
  agentName: string,
  prompt: string,
): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "glin-subagent-"),
  );
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, {
      encoding: "utf-8",
      mode: 0o600,
    });
  });
  return { dir: tmpDir, filePath };
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          return part.text;
        }
      }
    }
  }
  return "";
}

function isFailedResult(result: SingleResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.stopReason === "error" ||
    result.stopReason === "aborted"
  );
}

function getResultOutput(result: SingleResult): string {
  if (isFailedResult(result)) {
    return (
      result.errorMessage ||
      result.stderr ||
      getFinalOutput(result.messages) ||
      "(no output)"
    );
  }
  return getFinalOutput(result.messages) || "(no output)";
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
  cwd: string,
  agent: AgentConfig,
  task: string,
  inlineFiles: string[],
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
): Promise<SingleResult> {
  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | undefined;

  const currentResult: SingleResult = {
    agent: agent.name,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    model: agent.model,
  };

  const emitUpdate = () => {
    if (onUpdate) {
      onUpdate({
        content: [
          {
            type: "text",
            text: getFinalOutput(currentResult.messages) || "(running...)",
          },
        ],
        details: { results: [currentResult] },
      });
    }
  };

  try {
    if (agent.systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
    }

    const args = buildChildArgs(agent, task, tmpPromptPath, inlineFiles);
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) {
          return;
        }
        let event: {
          type?: string;
          message?: Message;
        };
        try {
          event = JSON.parse(line) as { type?: string; message?: Message };
        } catch {
          return;
        }

        if (event.type === "message_end" && event.message) {
          const msg = event.message;
          currentResult.messages.push(msg);

          if (msg.role === "assistant") {
            currentResult.usage.turns += 1;
            const usage = msg.usage;
            if (usage) {
              currentResult.usage.input += usage.input || 0;
              currentResult.usage.output += usage.output || 0;
              currentResult.usage.cacheRead += usage.cacheRead || 0;
              currentResult.usage.cacheWrite += usage.cacheWrite || 0;
              currentResult.usage.cost += usage.cost?.total || 0;
              currentResult.usage.contextTokens = usage.totalTokens || 0;
            }
            if (!currentResult.model && msg.model) {
              currentResult.model = msg.model;
            }
            if (msg.stopReason) {
              currentResult.stopReason = msg.stopReason;
            }
            if (msg.errorMessage) {
              currentResult.errorMessage = msg.errorMessage;
            }
          }
          emitUpdate();
        }

        if (event.type === "tool_result_end" && event.message) {
          currentResult.messages.push(event.message);
          emitUpdate();
        }
      };

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          processLine(line);
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        currentResult.stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (buffer.trim()) {
          processLine(buffer);
        }
        resolve(code ?? 0);
      });

      proc.on("error", (err) => {
        currentResult.stderr += err.message;
        resolve(1);
      });

      if (signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill("SIGKILL");
            }
          }, 5000);
        };
        if (signal.aborted) {
          killProc();
        } else {
          signal.addEventListener("abort", killProc, { once: true });
        }
      }
    });

    currentResult.exitCode = exitCode;
    if (wasAborted) {
      throw new Error("Subagent was aborted");
    }
    return currentResult;
  } finally {
    if (tmpPromptPath) {
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    }
    if (tmpPromptDir) {
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        /* ignore */
      }
    }
  }
}

type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(usage: UsageStats, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) {
    parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  }
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (model) parts.push(model);
  return parts.join(" ");
}

function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  themeFg: (color: any, text: string) => string,
): string {
  const shortenPath = (p: string) => {
    const home = os.homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  };

  switch (toolName) {
    case "bash": {
      const command = (args.command as string) || "...";
      const preview =
        command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
    }
    case "read": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let text = themeFg("accent", filePath);
      if (offset !== undefined || limit !== undefined) {
        const startLine = offset ?? 1;
        const endLine = limit !== undefined ? startLine + limit - 1 : "";
        text += themeFg(
          "warning",
          `:${startLine}${endLine ? `-${endLine}` : ""}`,
        );
      }
      return themeFg("muted", "read ") + text;
    }
    case "write": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const content = (args.content || "") as string;
      const lines = content.split("\n").length;
      let text = themeFg("muted", "write ") + themeFg("accent", filePath);
      if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit": {
      const rawPath = (args.file_path || args.path || "...") as string;
      return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
    }
    case "ls": {
      const rawPath = (args.path || ".") as string;
      return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
    }
    case "find": {
      const pattern = (args.pattern || "*") as string;
      const rawPath = (args.path || ".") as string;
      return (
        themeFg("muted", "find ") +
        themeFg("accent", pattern) +
        themeFg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    case "grep": {
      const pattern = (args.pattern || "") as string;
      const rawPath = (args.path || ".") as string;
      return (
        themeFg("muted", "grep ") +
        themeFg("accent", `/${pattern}/`) +
        themeFg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    default: {
      const argsStr = JSON.stringify(args);
      const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
    }
  }
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          items.push({ type: "text", text: part.text });
        } else if (part.type === "toolCall") {
          items.push({
            type: "toolCall",
            name: part.name,
            args: part.arguments as Record<string, unknown>,
          });
        }
      }
    }
  }
  return items;
}
