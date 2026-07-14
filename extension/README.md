# glin Pi extension

Registers:

- **`extract`** — `raw/` archive → `sources/` markdown node (images → `assets/`)
- **`subagent`** — bundled agent via isolated `pi` child (no agents bundled yet)

## Extract

```
extract({
  archive: "raw/example.com/blog-my-post",
  output: "sources/example.com/My Post Title.md"
})
```

`archive` and `output` are KB-relative. Default model: `google/gemini-3.1-flash-lite`
(optional `model` override). Prompts: `extract-prompt.md`, `summary-prompt.md`.

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
  agents.ts / agents/   # subagent runner (empty agents/)
  README.md
```
