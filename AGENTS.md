# AGENTS.md — glin (source repo)

glin is a command-line tool for building local, LLM-curated knowledge bases.
This repository is the *tool*; the knowledge bases it operates on are separate data repositories.
When you work here, you are building glin itself — not curating a knowledge base.

## What glin is for

A knowledge base is a directory of plaintext files, with three major directories:

- **raw/** — immutable fetched originals (HTML, PDFs, images, transcripts).
- **sources/** — faithful markdown extractions of raw, one per article/paper/episode (`type: source`, near-immutable, cite-only).
- **wiki/** — the fluid working knowledge space the LLM builds and reorganizes (`type: wiki`).

An LLM agent (via Pi) does the reading, writing, and reorganizing; a human rarely edits the files.
Retrieval is structural — index files, frontmatter summaries, links, grep, search.
The authoritative description of this model, the frontmatter schema, and the conventions lives in `templates/`,
which glin installs into every knowledge base.
Read them for the full picture.

For further details of design and decisions, refer to the `doc/` directory.

## Architecture

glin does not embed an agent loop.
It provides the *mechanical* primitives an agent calls; the harness (such as Pi) supplies the loop, and skills/prompts supply the judgment. 
The division is strict and load-bearing:

- **glin (code) does the deterministic, mechanical work:** fetching, localizing images, regenerating indexes, maintaining caches, running search.
- **skills + the LLM do the judgment work:** extracting main content from raw, writing and organizing the wiki, deciding what connects to what.

Concretely: **`glin fetch` downloads and archives a page faithfully — it does not extract, clean, or interpret content.
** Do not add readability or boilerplate-removal heuristics to it.
Content extraction is an LLM skill that reads `raw/` and writes `sources/`; 
glin's only job is to land `raw/` on disk correctly — download the page and its images, 
rewrite image references to the local copies, and keep a truthful record of the original.

This repo also holds the templates glin stamps into new knowledge bases (`glin init`) and, later, a Pi extension for tighter integration.
Because the templates ship with glin, `glin upgrade` may overwrite a KB's `SYSTEM.md` and skills, but never its `AGENTS.md`, which the KB owns.

## Repo layout

```
glin/
  package.json          bin: { glin: dist/cli.js }
  src/
    cli.ts              arg parsing + dispatch
    commands/           one file per subcommand
    lib/                reusable logic (fetch, html rewrite, frontmatter, …)
  templates/            stamped into new KBs by `glin init`
    SYSTEM.md
    AGENTS.md           the KB skeleton
    skills/
  extension/            Pi integration (later)
```

Keep subcommands as thin wrappers over `lib/` functions, so the same logic is reusable when glin is later embedded via Pi's SDK or RPC.

## Conventions

- **TypeScript / Node**, chosen deliberately: it shares a toolchain with Pi, so the CLI and the future Pi extension can share code and glin can be embedded via Pi's SDK later.
- **One binary, subcommands:** `glin fetch | search | reindex | backlinks | init | upgrade`. One thing to install and version; one `--help` surface.
- **Convention over configuration.** Hardcode the KB skeleton (`raw/ sources/ wiki/ assets/`); do not parameterize layout or frontmatter yet. Promote something to config only when a real second KB needs it to differ.
- **Language-agnostic invocation.** The agent calls glin by shelling out, so every command must be usable and legible from a plain terminal, with a clear `--help`.
- **Local dev:** `npm link` to put `glin` on PATH; edits go live without reinstalling.

## Development guidance

- Prefer few dependencies, ask me before adding any.
