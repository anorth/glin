# glin Pi extension

Registers:

- **`extract`** — `raw/` archive → `sources/` markdown node (images → `assets/`)
- **`subagent`** — isolated child `pi`; default is a generic context-aware delegate

## Extract

```
extract({
  archive: "raw/example.com/blog-my-post",
  output: "sources/example.com/My Post Title.md"
})
```

`archive` and `output` are KB-relative. Default model: `google/gemini-3.1-flash-lite`
(optional `model` override). Prompts: `extract-prompt.md`, `summary-prompt.md`.

## Subagent

```
subagent({ task: "..." })
subagent({ task: "...", files: ["path/to/file"], model: "provider/id" })
subagent({ agent: "name", task: "..." })  # optional specialized bundled agent
```

Omit `agent` (or pass `"generic"`) for the generic delegate: loads `AGENTS.md` and
KB skills; inherits default Pi tools and other extension tools (e.g. `extract`);
excludes only the `subagent` tool (`--exclude-tools subagent`) to avoid nesting.
It never passes `--approve`/`--no-approve`, so `.pi/SYSTEM.md` and other trust-gated
project resources load only if the KB folder is already trusted (saved decision or
`defaultProjectTrust`) — same as the parent pi process, since the child runs in the
same directory.

Named agents (if any) live in `agents/*.md` and are isolated by default (no context
files, no skills). A non-empty agent body is passed as `--system-prompt`, which
replaces project `SYSTEM.md`. They still inherit ambient project trust (settings,
etc.) rather than forcing `--no-approve`. None are bundled yet.

## Install (manual, until `glin init` / `upgrade`)

From the KB root:

```bash
mkdir -p .pi/extensions
ln -sfn /path/to/glin/extension .pi/extensions/glin
```

Or one-off: `pi -e /path/to/glin/extension`. Reload with `/reload` while developing.

## Development

```bash
npm install
npm run typecheck
npm test
```

Pi loads TypeScript via `jiti` (no build). Pi packages are root `devDependencies` for tsc/editor only.

```
extension/
  index.ts              # extract + subagent
  extract.ts            # extract tool
  extract-prompt.md
  summary-prompt.md
  agents.ts / agents/   # subagent runner + optional named agents (empty)
  README.md
```
