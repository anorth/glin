# glin Pi extension

Minimal Pi extension that registers a `subagent` tool for glin knowledge-base
workflows. Bundled agents live in `agents/` and run as isolated `pi` child
processes with a pinned model and a self-contained system prompt.

## Agents

| Agent | Default Model | Purpose |
| --- | --- | --- |
| `extract` | `google/gemini-3.1-flash-lite` | Turn a `raw/` archive into a faithful `sources/` node; adopt used images into `assets/` |

## Install into a knowledge base (manual, until `glin init` / `upgrade`)

From the knowledge-base root:

```bash
mkdir -p .pi/extensions
ln -sfn /path/to/glin/extension .pi/extensions/glin
```

Pi auto-discovers `.pi/extensions/*/index.ts` after the project is trusted.
Reload with `/reload` while developing.

Alternatively, for a one-off session without linking:

```bash
pi -e /path/to/glin/extension
```

## Usage

In a Pi session at the KB root, after a page has been fetched into `raw/`:

```
Use the extract subagent on raw/example.com/blog-my-post
```

The parent agent should call:

```
subagent({ 
    agent: "extract", 
    task: "Extract the archive at raw/example.com/blog-my-post into a source node",
    files: [
        "raw/example.com/blog-my-post/meta.json",
        "raw/example.com/blog-my-post/index.html",
    ]
})
```

The child runs with `--system-prompt` (path to a temp file holding the agent body),
`--no-context-files`, `--no-skills`, `--no-extensions`, and `--no-approve`, 
so it does **not** inherit the KB's `SYSTEM.md` or `AGENTS.md`. 
All extraction rules live in `agents/extract.md`.

## Development

From the glin repo root:

```bash
npm install
npm run typecheck   # CLI + extension
npm test            # includes extension/agents.test.ts
```

Pi loads the TypeScript sources via `jiti` — no build step. 
Pi type packages live in the root `devDependencies` for editor and `tsc` checks only.

## Layout

```
extension/
  index.ts           # registers the subagent tool
  agents.ts          # agent discovery + child argv construction
  agents/
    extract.md       # extract agent (frontmatter + system prompt)
  README.md
```
