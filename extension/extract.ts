/**
 * Dedicated extract tool — two toolless in-process LLM calls, no child tools.
 *
 * Flow:
 *   1. Validate KB-relative archive + output paths; read meta.json + index.html
 *   2. Body call: inline index.html only; model returns markdown body (no frontmatter)
 *   3. Require leading H1; summary call returns JSON (summary + optional author/publication)
 *   4. adoptSourceAssets rewrites archive-relative image refs to /assets/<hash>.<ext>
 *   5. Fail hard (write nothing) on adoption errors or invalid image refs
 *      (must be existing /assets/… or data:/blob:)
 *   6. Build YAML frontmatter from meta.json + archive path (title from leading H1;
 *      author/publication: meta wins, else summary inference, else omit)
 *   7. Write frontmatter + body once
 *
 * The outer LLM chooses the title-based output path; this tool never invents it.
 * Frontmatter id is src-<archive-slug>, independent of the filename.
 * Body must start with an H1; that H1 is preferred for frontmatter title over meta.title.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai/compat";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  getMarkdownTheme,
  ModelRegistry,
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

import { adoptSourceAssets, findInvalidSourceImageRefs } from "../src/lib/assets.ts";

const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const EXTRACT_PROMPT_PATH = join(EXTENSION_DIR, "extract-prompt.md");
const SUMMARY_PROMPT_PATH = join(EXTENSION_DIR, "summary-prompt.md");

const ExtractParams = Type.Object({
  archive: Type.String({
    description: "KB-relative path to the raw/ archive directory (e.g. raw/example.com/blog-my-post).",
  }),
  output: Type.String({
    description: "KB-relative path for the source markdown file (e.g. sources/example.com/My Article Title.md). Title-based filename; place under sources/ per wiki conventions.",
  }),
  model: Type.Optional(
    Type.String({
      description: `Model as provider/id (default: ${DEFAULT_MODEL}).`,
    }),
  ),
});

type ExtractParams = {
  archive: string;
  output: string;
  model?: string;
};

type UsageStats = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

type ExtractDetails = {
  archive: string;
  output: string;
  model?: string;
  adopted?: string[];
  deduplicated?: string[];
  usage?: UsageStats;
};

/** Fields we read from meta.json for programmatic frontmatter. */
type ArchiveMeta = {
  source_url?: unknown;
  final_url?: unknown;
  canonical_url?: unknown;
  fetched?: unknown;
  title?: unknown;
  author?: unknown;
  publication?: unknown;
};

/** Pi accepts isError on tool results at runtime; AgentToolResult typings omit it. */
type ExtractToolResult = AgentToolResult<ExtractDetails> & { isError?: boolean };

/** Injectable toolless LLM call (body + summary). Default talks to Pi in-process. */
export type ExtractModelCall = (args: {
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal | undefined;
  onText: (text: string) => void;
}) => Promise<{
  text: string;
  error?: string;
  usage?: UsageStats;
}>;

export type RunExtractDeps = {
  modelCall?: ExtractModelCall;
};

/** Register the `extract` tool on the extension API. */
export function registerExtractTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "extract",
    label: "Extract",
    description: [
      "Extract a raw/ archive into a sources/ markdown node (title-based output path).",
      "Pass archive (raw/… dir) and output (sources/…/Title.md), both KB-relative.",
      "Do not perform content extraction yourself when this tool is available.",
    ].join(" "),
    parameters: ExtractParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return runExtract(params, signal, onUpdate, ctx);
    },

    renderCall(args, theme) {
      const archive = (args.archive as string) || "...";
      const output = (args.output as string) || "...";
      const text =
        theme.fg("toolTitle", theme.bold("extract ")) +
        theme.fg("accent", archive) +
        `\n  ${theme.fg("dim", "→ " + output)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as ExtractDetails | undefined;
      const failed = Boolean((result as ExtractToolResult).isError);
      const icon = failed
        ? theme.fg("error", "✗")
        : theme.fg("success", "✓");
      const body =
        result.content[0]?.type === "text"
          ? result.content[0].text
          : "(no output)";
      const mdTheme = getMarkdownTheme();

      if (expanded) {
        const container = new Container();
        container.addChild(
          new Text(
            `${icon} ${theme.fg("toolTitle", theme.bold("extract"))}`,
            0,
            0,
          ),
        );
        if (details?.archive) {
          container.addChild(
            new Text(theme.fg("dim", details.archive), 0, 0),
          );
        }
        if (details?.output && !failed) {
          container.addChild(
            new Text(theme.fg("dim", `→ ${details.output}`), 0, 0),
          );
        }
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(body.trim(), 0, 0, mdTheme));
        const usageStr = formatExtractUsage(details);
        if (usageStr) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
        }
        return container;
      }

      const lines = body.trim().split("\n");
      const preview = lines.slice(0, 3).join("\n");
      let text = `${icon} ${theme.fg("toolTitle", theme.bold("extract"))}`;
      if (details?.output && !failed) {
        text += `\n${theme.fg("toolOutput", details.output)}`;
      }
      text += `\n${theme.fg(failed ? "error" : "toolOutput", preview)}`;
      if (lines.length > 3) {
        text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
      }
      const usageStr = formatExtractUsage(details);
      if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
      return new Text(text, 0, 0);
    },
  });
}

/** End-to-end: validate → body call → summarize → adopt → frontmatter → write. */
export async function runExtract(
  params: ExtractParams,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<ExtractDetails>) => void) | undefined,
  ctx: Pick<ExtensionContext, "cwd">,
  deps: RunExtractDeps = {},
): Promise<ExtractToolResult> {
  const details: ExtractDetails = {
    archive: params.archive,
    output: params.output,
    model: params.model ?? DEFAULT_MODEL,
  };

  const fail = (message: string): ExtractToolResult => ({
    content: [{ type: "text", text: message }],
    details,
    isError: true,
  });

  const emit = (text: string) => {
    onUpdate?.({
      content: [{ type: "text", text }],
      details,
    });
  };

  const archiveRel = normalizeKbRelative(params.archive);
  if (!archiveRel) {
    return fail(
      `Invalid archive path (must be KB-relative, no ..): ${params.archive}`,
    );
  }
  if (!archiveRel.startsWith("raw/")) {
    return fail(`Archive path must be under raw/: ${archiveRel}`);
  }
  const outputRel = normalizeKbRelative(params.output);
  if (!outputRel) {
    return fail(
      `Invalid output path (must be KB-relative, no ..): ${params.output}`,
    );
  }
  if (!outputRel.startsWith("sources/")) {
    return fail(`Output path must be under sources/: ${outputRel}`);
  }
  if (!outputRel.endsWith(".md")) {
    return fail(`Output path must end in .md: ${outputRel}`);
  }

  const kbRoot = resolve(ctx.cwd);
  const archivePath = resolveWithinKb(kbRoot, archiveRel);
  if (!archivePath) {
    return fail(`Archive path escapes KB root: ${archiveRel}`);
  }
  const outputPath = resolveWithinKb(kbRoot, outputRel);
  if (!outputPath) {
    return fail(`Output path escapes KB root: ${outputRel}`);
  }

  const metaPath = join(archivePath, "meta.json");
  const htmlPath = join(archivePath, "index.html");
  if (
    !existsSync(archivePath) ||
    !existsSync(metaPath) ||
    !existsSync(htmlPath)
  ) {
    return fail(
      `Archive incomplete or missing (need meta.json + index.html): ${archiveRel}`,
    );
  }

  let meta: ArchiveMeta;
  let indexHtml: string;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf8")) as ArchiveMeta;
    indexHtml = await readFile(htmlPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Failed to read archive files: ${message}`);
  }

  const modelSpec = params.model?.trim() || DEFAULT_MODEL;
  details.model = modelSpec;

  let modelCall = deps.modelCall;
  if (!modelCall) {
    const resolved = resolveDefaultModelCall(modelSpec, signal);
    if ("error" in resolved) {
      return fail(resolved.error);
    }
    details.model = resolved.modelId;
    modelCall = resolved.modelCall;
  }

  emit("Extracting body…");

  let bodyMarkdown: string;
  try {
    const extractPrompt = await readFile(EXTRACT_PROMPT_PATH, "utf8");
    const result = await modelCall({
      systemPrompt: extractPrompt,
      userPrompt: [
        `<file name="${archiveRel}/index.html">`,
        indexHtml,
        "</file>",
        "",
        "Extract the main content of this HTML page into faithful markdown.",
        "Return only the markdown body (no frontmatter). Start with an H1 title.",
      ].join("\n"),
      signal,
      onText: emit,
    });
    details.usage = addUsage(details.usage, result.usage);
    if (result.error) {
      return fail(result.error);
    }
    bodyMarkdown = result.text.trim();
    if (!bodyMarkdown) {
      return fail("Model returned empty extraction.");
    }
  } catch (error) {
    if (signal?.aborted) {
      return fail("Extract was aborted.");
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Extraction model call failed: ${message}`);
  }

  const h1Title = leadingH1Title(bodyMarkdown);
  if (!h1Title) {
    return fail(
      "Extraction aborted: body must start with an ATX H1 title (# ...).",
    );
  }

  emit("Summarizing…");

  let summaryText: string;
  let inferredAuthor: string | null = null;
  let inferredPublication: string | null = null;
  try {
    const summaryPrompt = await readFile(SUMMARY_PROMPT_PATH, "utf8");
    const result = await modelCall({
      systemPrompt: summaryPrompt,
      userPrompt: [
        "Extract navigation metadata for the following article:",
        "",
        bodyMarkdown,
      ].join("\n"),
      signal,
      onText: emit,
    });
    details.usage = addUsage(details.usage, result.usage);
    if (result.error) {
      return fail(result.error);
    }
    const parsed = parseSummaryPayload(result.text);
    if (!parsed) {
      return fail("Summary model returned invalid JSON (need summary, author, publication).");
    }
    summaryText = parsed.summary;
    inferredAuthor = parsed.author;
    inferredPublication = parsed.publication;
  } catch (error) {
    if (signal?.aborted) {
      return fail("Extract was aborted.");
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Summary model call failed: ${message}`);
  }

  emit("Adopting assets…");

  const adoption = await adoptSourceAssets({
    markdown: bodyMarkdown,
    archivePath,
    kbRoot,
  });
  details.adopted = adoption.adopted;
  details.deduplicated = adoption.deduplicated;

  const invalidRefs = findInvalidSourceImageRefs(adoption.markdown, kbRoot);
  if (adoption.errors.length > 0 || invalidRefs.length > 0) {
    const parts: string[] = ["Extraction aborted: asset adoption failed."];
    if (adoption.errors.length > 0) {
      parts.push(`Errors:\n- ${adoption.errors.join("\n- ")}`);
    }
    if (invalidRefs.length > 0) {
      parts.push(
        `Invalid image refs (need /assets/<file> on disk, or data:/blob:):\n- ${invalidRefs.join("\n- ")}`,
      );
    }
    return fail(parts.join("\n"));
  }
  bodyMarkdown = adoption.markdown;

  const title = h1Title;

  const sourceUrl = resolveSourceUrl(meta);
  if (!sourceUrl) {
    return fail(
      "meta.json missing usable source_url / final_url / canonical_url.",
    );
  }
  const fetched = fetchedDate(meta.fetched);
  if (!fetched) {
    return fail("meta.json missing usable fetched timestamp.");
  }

  const frontmatter = buildSourceFrontmatter({
    archiveRel,
    title,
    // meta.json wins; model fills gaps only
    author: optionalMetaString(meta.author) ?? inferredAuthor,
    publication: optionalMetaString(meta.publication) ?? inferredPublication,
    sourceUrl,
    fetched,
    summary: summaryText,
  });
  const document = `${frontmatter}\n${bodyMarkdown.trimStart()}`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, document, "utf8");

  const summary = [
    `Ok: wrote ${outputRel}`,
    `adopted=${adoption.adopted.length} deduplicated=${adoption.deduplicated.length}`,
  ];
  if (details.usage) {
    summary.push(
      `tokens ↑${details.usage.input} ↓${details.usage.output} $${details.usage.cost.toFixed(4)}`,
    );
  }

  return {
    content: [{ type: "text", text: summary.join("\n") }],
    details,
  };
}

/** Resolve the default in-process model call, or an error if the model is unknown. */
function resolveDefaultModelCall(
  modelSpec: string,
  signal: AbortSignal | undefined,
): { modelId: string; modelCall: ExtractModelCall } | { error: string } {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolveModel(modelRegistry, modelSpec);
  if (!model) {
    return { error: `Unknown model: ${modelSpec}` };
  }
  const modelId = `${model.provider}/${model.id}`;
  const modelCall: ExtractModelCall = (args) =>
    runToollessModelCall({
      model,
      authStorage,
      modelRegistry,
      signal,
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      onText: args.onText,
    });
  return { modelId, modelCall };
}

/** Build source-node YAML frontmatter from deterministic fields + summary. */
function buildSourceFrontmatter(fields: {
  archiveRel: string;
  title: string;
  author: string | null;
  publication: string | null;
  sourceUrl: string;
  fetched: string;
  summary: string;
}): string {
  const slug = basename(fields.archiveRel);
  const lines = [
    "---",
    `id: ${yamlScalar(`src-${slug}`)}`,
    "type: source",
    `title: ${yamlScalar(fields.title)}`,
  ];
  if (fields.author) {
    lines.push(`author: ${yamlScalar(fields.author)}`);
  }
  if (fields.publication) {
    lines.push(`publication: ${yamlScalar(fields.publication)}`);
  }
  lines.push(
    `source_url: ${yamlScalar(fields.sourceUrl)}`,
    `fetched: ${yamlScalar(fields.fetched)}`,
    `raw: ${yamlScalar(`${fields.archiveRel}/`)}`,
    `summary: ${yamlScalar(fields.summary)}`,
    "---",
    "",
  );
  return lines.join("\n");
}

/** Double-quote YAML scalars via JSON encoding (always safe). */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/** Prefer canonical_url, then final_url, then source_url. */
function resolveSourceUrl(meta: ArchiveMeta): string | null {
  return (
    optionalMetaString(meta.canonical_url) ??
    optionalMetaString(meta.final_url) ??
    optionalMetaString(meta.source_url)
  );
}

/** YYYY-MM-DD from an ISO (or already-date) fetched string. */
function fetchedDate(value: unknown): string | null {
  const raw = optionalMetaString(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** Non-empty string from a meta field, else null. */
function optionalMetaString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** First line of body must be an ATX H1; returns its title text. */
function leadingH1Title(markdown: string): string | null {
  const match = markdown.trimStart().match(/^#\s+(.+?)\s*(?:\n|$)/);
  if (!match) return null;
  const title = match[1].replace(/\s+#+\s*$/, "").trim();
  return title.length > 0 ? title : null;
}

/** Parse summary-model JSON into summary + optional author/publication. */
function parseSummaryPayload(text: string): {
  summary: string;
  author: string | null;
  publication: string | null;
} | null {
  const raw = stripJsonFences(text.trim());
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const summary = normalizeSummary(
    typeof obj.summary === "string" ? obj.summary : "",
  );
  if (!summary) {
    return null;
  }
  return {
    summary,
    author: optionalInferredString(obj.author),
    publication: optionalInferredString(obj.publication),
  };
}

/** Allow null / missing / blank; reject non-strings and bare http(s) URLs. */
function optionalInferredString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Strip optional ``` / ```json fences around model JSON. */
function stripJsonFences(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : text;
}

/** Collapse summary prose to a single plain-text paragraph. */
function normalizeSummary(text: string): string {
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addUsage(
  a: UsageStats | undefined,
  b: UsageStats | undefined,
): UsageStats | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cost: a.cost + b.cost,
  };
}

/** Normalize a caller path to a safe KB-relative form, or null if absolute/escaping. */
function normalizeKbRelative(p: string): string | null {
  const trimmed = p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!trimmed || isAbsolute(trimmed)) {
    return null;
  }
  const segs = trimmed.split("/");
  if (segs.includes("..") || segs.includes("")) {
    return null;
  }
  return trimmed;
}

/** Resolve relPath under kbRoot; null if the result would escape the KB. */
function resolveWithinKb(kbRoot: string, relPath: string): string | null {
  const resolved = resolve(kbRoot, relPath);
  const rel = relative(kbRoot, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

/** Parse provider/id and look up the model in the registry. */
function resolveModel(
  modelRegistry: ModelRegistry,
  spec: string,
): Model<string> | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) {
    return undefined;
  }
  const provider = spec.slice(0, slash);
  const id = spec.slice(slash + 1);
  return modelRegistry.find(provider, id);
}

/**
 * Single toolless in-process model call with an explicit system + user prompt.
 * Isolated from KB skills/extensions/context; no tools available to the model.
 */
async function runToollessModelCall(options: {
  model: Model<string>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal | undefined;
  onText: (text: string) => void;
}): Promise<{
  text: string;
  error?: string;
  usage?: UsageStats;
}> {
  const agentDir = getAgentDir();

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    model: options.model,
    thinkingLevel: "off",
    noTools: "all",
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });

  const onAbort = () => {
    void session.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) {
      session.dispose();
      return { text: "", error: "Extract was aborted." };
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        const text = getFinalAssistantText(session.messages);
        if (text) options.onText(text);
      }
    });

    await session.prompt(options.userPrompt);

    const stats = session.getSessionStats();
    const usage: UsageStats = {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
      cost: stats.cost,
    };

    const text = getFinalAssistantText(session.messages);
    const errorMessage = findAssistantError(session.messages);
    if (errorMessage) {
      return { text: text || "", error: errorMessage, usage };
    }
    if (!text) {
      return { text: "", error: "Model returned no text.", usage };
    }
    return { text, usage };
  } finally {
    if (options.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }
    session.dispose();
  }
}

/** Last assistant text part in the session transcript. */
function getFinalAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Message;
    if (msg && msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          return part.text;
        }
      }
    }
  }
  return "";
}

/** Surface model stopReason error/aborted from the last assistant message, if any. */
function findAssistantError(messages: readonly unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Message & {
      stopReason?: string;
      errorMessage?: string;
    };
    if (msg && msg.role === "assistant") {
      if (msg.stopReason === "error" || msg.stopReason === "aborted") {
        return msg.errorMessage || `Model stopReason: ${msg.stopReason}`;
      }
      return undefined;
    }
  }
  return undefined;
}

/** Compact token/cost/adoption line for the tool result UI. */
function formatExtractUsage(details: ExtractDetails | undefined): string {
  if (!details?.usage) return "";
  const u = details.usage;
  const parts: string[] = [];
  if (u.input) parts.push(`↑${u.input}`);
  if (u.output) parts.push(`↓${u.output}`);
  if (u.cost) parts.push(`$${u.cost.toFixed(4)}`);
  if (details.model) parts.push(details.model);
  if (details.adopted) {
    parts.push(`adopted:${details.adopted.length}`);
  }
  if (details.deduplicated) {
    parts.push(`dedup:${details.deduplicated.length}`);
  }
  return parts.join(" ");
}
