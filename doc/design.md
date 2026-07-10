# glin — Design & Decisions

*Internal design record. This document captures the goals, architecture, and
design decisions behind glin so that development can continue with full context.
It is written to be self-contained — the key conventions are restated here — but
where it disagrees with the live `SYSTEM.md`, the `AGENTS.md` templates, or the source
code, those are authoritative and this record should be updated to match. It
reflects decisions made during early development and is expected to evolve.*

---

## 1. What glin is

glin is a command-line tool for building **local, LLM-curated knowledge bases**. A
knowledge base (KB) is a directory of plaintext files — mostly markdown — plus
media, which an LLM agent reads, writes, and reorganizes on the human's behalf.

glin itself is deliberately small. It provides the *mechanical* primitives an
agent calls (fetching pages, regenerating indexes, maintaining caches, searching);
the agent runs inside an existing harness (**Pi**, https://pi.dev), and
prompts/skills supply its judgment. glin does not contain an agent loop.

The approach is inspired by Andrej Karpathy's practice of using LLMs to "compile" a
wiki of markdown files from raw source documents, then querying and extending it
with an agent and viewing it in Obsidian. A key observation from that practice
shapes glin: at the ~100-article scale, this needs **no fancy RAG** — the LLM can
maintain index files and per-document summaries and simply read the files it
needs.

---

## 2. Goals & motivation

The purpose is to support independent research projects by gathering a large body
of research, evidence, and opinion on a topic into one curated, queryable place.
Each project gets its own KB.

Requirements that shaped the whole design:

- **Local and under the user's control.** The data lives as files in a single
  directory hierarchy on the user's machine, and the tooling works primarily with
  those files on disk. This rules out closed consumer tools like Notion, which
  can't be bent to arbitrary tooling.
- **LLM-curated.** The heavy lifting of extracting, summarizing, organizing, and
  synthesizing is done by LLMs, not brittle heuristic code.
- **Scales structurally.** An early trial of OpenKB
  (github.com/VectifyAI/OpenKB) produced a *flat* structure for both sources and
  concepts, which doesn't scale (among other shortcomings).
  glin is hierarchical from the start, with index files summarizing content beneath them.

---

## 3. Guiding principles

These themes recur throughout and explain most individual decisions:

- **Plaintext-first.** Markdown/text on disk is the canonical format. It diffs
  cleanly in git, greps well, is portable across tools, and — most importantly —
  is what LLM agents read and write most reliably. Richer render targets (HTML,
  slides) are *outputs*, not the source of truth.
- **The LLM owns the wiki.** The agent does almost all reading, writing, and
  reorganizing; the human rarely edits files directly.
- **Code does the mechanical work; the LLM does the judgment work.** This boundary
  is strict and load-bearing (see §5).
- **Structural retrieval, not vector RAG.** Navigate by indexes, summaries, links,
  backlinks, grep, and a search tool. No vector database is assumed at this scale.
- **git is the safety net.** Everything is plaintext and versioned, so any change
  is reversible. This licenses a posture of *acting over asking* when an operation
  is reversible, reserving caution for irreversible ones.
- **Convention over configuration.** Hardcode sensible structure; introduce
  configuration only when a real second case needs to differ.
- **Make room for the future; defer building it.** Design seams that anticipate
  later capabilities (media fetching, embedding search) without building them now.
- **Everything downstream is regenerable from the tier above it.** This is the
  backbone of the data model's integrity.

---

## 4. The knowledge base data model

### 4.1 Three tiers

A KB has three layers; each is a projection of the one above and can be
regenerated from it.

1. **raw/** — the immutable archive. Fetched material exactly as retrieved: HTML
   (with image references localized), PDFs, images, and transcripts of audio or
   video. Never edited. Keeping raw makes extraction *reproducible and improvable*:
   if the extraction prompt improves later, re-run it against raw rather than
   re-fetching the web (which may have changed or vanished). Raw may become
   evictable later for heavy media (see §11).
2. **sources/** — faithful clean extractions. One markdown node per article,
   paper, or episode: the main content preserved faithfully, noise (nav, ads,
   boilerplate) dropped. Sources are near-immutable and **cite-only** — never
   rewritten or editorialized; the only reason to change one is to re-extract it
   from its raw original.
3. **wiki/** — the fluid working knowledge space, built and reorganized freely.
   Content may derive from sources, from conversations, or be written directly. It
   has **no mandated internal organization** — deliberately. We resisted baking in
   a concept-oriented structure (as OpenKB and some framings assume); the wiki's
   shape is per-KB and expected to change as understanding grows.

Future top-level directories may be added in the future, e.g. a **chats/** directory for chat transcripts.

### 4.2 Knowledge base directory layout

A knowledge base is structured as follows:

```
<kb-root>/
  .pi/SYSTEM.md  Pi system prompt override
  AGENTS.md      per-KB conventions (human-owned; never overwritten by glin)
  raw/           immutable fetched originals
  sources/       faithful extractions          (type: source)
  wiki/          working knowledge space         (type: wiki)
  assets/        pooled media store
  index.md       top-level navigation index
```

This skeleton is invariant; the tools assume it. `sources/` mirrors the shape of
the material — a publication gets a directory with its posts beneath it; an
institution with several publications nests a level deeper; a standalone paper
sits directly in `sources/`. Depth is variable, used only as far as the material
needs.

### 4.3 Node types

Every markdown node declares `type` in its frontmatter:

- `type: source` — faithful, near-immutable, cite-only.
- `type: wiki` — fluid, freely edited and reorganized.

This single distinction is all the tooling needs: never mutate a `source`'s
content; freely maintain anything `wiki`. We deliberately chose the neutral label
`wiki` over `derived`/`concept`, because wiki content isn't necessarily
derived-from-sources (it can originate from the human or a chat) and isn't
necessarily concept-organized.

### 4.4 Frontmatter

Every node opens with YAML frontmatter. Required on every node: `id`, `type`,
`title`, `summary`. A node without a good `summary` is effectively invisible,
because indexes and navigation are built from summaries.

- **Source nodes** additionally carry: `source_url`, `fetched` (YYYY-MM-DD),
  `author`, and `raw` (path to the archived original).
- **Wiki nodes** additionally carry: `updated` (YYYY-MM-DD), optional `tags`, and
  optional `cites` (list of source `id`s the node rests on; omitted if none).

Example source node:

```yaml
---
id: src-hattie-visible-learning-2023
type: source
title: "Visible Learning: The Sequel"
author: John Hattie
source_url: https://…
fetched: 2026-06-14
raw: raw/…/
summary: >
  Meta-synthesis updating effect sizes across influences on achievement.
---
```

Example wiki node:

```yaml
---
id: wiki-effect-sizes
type: wiki
title: Effect Sizes in Education Research
tags: [methodology, meta-analysis]
cites: [src-hattie-visible-learning-2023]
updated: 2026-06-20
summary: >
  What effect sizes mean, why 0.4 became a benchmark, and key critiques.
---
```

The schema is intentionally lean and **additively extensible**: a KB may define
extra keys or vocabularies in its `AGENTS.md`, and the tools ignore keys they
don't recognize, so extension is safe.

### 4.5 IDs & naming

IDs are stable for the life of a node and never reused: `src-<slug>` for sources,
`wiki-<slug>` for wiki nodes. Stability matters because wiki files move freely
during reorganization; a stable id lets references and backlinks survive the move.

### 4.6 Links & provenance

Two distinct kinds of link, chosen for different stability needs:

- **Citations (wiki → source)** are by source `id`, in the `cites` frontmatter
  list. This is the provenance spine. Sources are archival and rarely move, so
  id-based citation keeps provenance robust. The agent must never invent a
  citation or attribute a claim to a source that doesn't support it.
- **Cross-links (wiki → wiki, source → source)** are markdown links with readable
  display text. Prefer vault-root absolute paths, e.g.
  `[effect sizes](/wiki/methodology/effect-sizes.md)` — the form OKF and
  Obsidian both support. Absolute links stay valid when a node moves within its
  subtree; repair inbound links on rename/move anyway (see below). Chosen over
  Obsidian-specific `[[wikilinks]]` for portability across agents and tools.

**Link integrity is a workflow guarantee, not a format property.** When a node is
moved or renamed, repairing every inbound link/citation is part of the move, not
an optional follow-up — because the agent edits files outside any editor's
link-repair machinery. A backlinks index makes this fast and doubles as a
navigation aid, but it is a **regenerable cache**; the inline links in the files
are always the source of truth.

### 4.7 Indexes

There are two unrelated things called "index"; keep them distinct:

- **`index.md` files** are human-readable markdown navigation maps — one per
  directory — listing children with their summaries so an agent can find its way.
  They are *content/curation artifacts*: derived views of the frontmatter
  summaries beneath them (summaries are the source of truth), regenerable by
  `glin reindex`. When a child is itself a directory, the index references that
  subdirectory's own rolled-up summary rather than listing every descendant, so
  summaries roll up the tree and parent indexes stay small. A soft branching
  guideline (keep a directory under ~15–20 children; else introduce a grouping
  subdirectory) keeps indexes bounded. The authoring convention for these lives in
  the curation skill.
- **The search index** is a *tool-internal* structure (text and/or vector). The
  agent never reads it as a file; it queries it through `glin search`. Its format
  is glin's concern only.

### 4.8 Media & assets

- Diagrams, math, and small tables are **text**, not files: mermaid fenced blocks,
  LaTeX math, and markdown tables. They diff cleanly and travel with their node.
- Real image/figure files live in a **pooled per-KB `assets/` store**, referenced
  by vault-root absolute path (e.g. `/assets/abcd123.png`). Pooling keeps
  references stable when nodes move and gives free deduplication.
- Images downloaded with a source may initially be referenced from that source's
  raw `images/` folder; the intended end state is to **copy the images a source
  actually uses into `assets/`** so that no live node references into raw and raw
  becomes cleanly severable. Whether to do this eagerly or lazily is a per-KB
  policy (default lazy); the two are coupled — the more you want raw evictable, the
  more you want to copy eagerly.
- Generated figures (plots, crops) go into `assets/`.

### 4.9 Retrieval

Retrieval is structural: indexes, frontmatter summaries, links, backlinks, grep,
and `glin search`. This directly follows Karpathy's finding that index files plus
per-doc summaries make vector RAG unnecessary at this scale. Embedding-based search
is a possible future addition (see §11), not a current dependency.

---

## 5. Architecture

### 5.1 glin is a toolbox, not an agent

glin does not embed an agent loop, model calls, or context management — all
undifferentiated plumbing that a harness already provides. The agent harness (Pi)
supplies the loop; skills and prompts supply the judgment; glin supplies mechanical
primitives. This is why we build *tools for* an agent rather than *a tool that
invokes* an agent: the durable, differentiated work (skills + CLI primitives) is
the same either way, and it's portable to any harness. Pi's SDK/RPC modes leave a
clean path to later wrapping glin in a custom top-level binary without discarding
any of it.

### 5.2 The code-vs-judgment boundary

The strict rule: **code does mechanical, deterministic work; the LLM does
judgment work.** Concretely, `glin fetch` archives a page faithfully but does *not*
extract, clean, or interpret its content — content extraction (deciding what the
"main content" is, dropping noise) is an LLM skill. A coding agent's reflex is to
reach for a readability/boilerplate-removal library; that is exactly the
complexity glin deliberately avoids, because that task can't be well-defined in
code and the LLM's instincts are better. Do not add content-extraction heuristics
to glin.

### 5.3 Tooling vs. data (two kinds of repo)

There are two distinct things: **glin the tool** (one codebase, versioned,
installed once, shared across every KB) and **a knowledge base** (data for one
project; there will be many). The glin repo holds the CLI source, the Pi
extension(s) (later), and the templates stamped into new KBs. A KB is a separate
data repo. `glin init` stamps a new KB from templates; the CLI is never copied
into a KB.

### 5.4 Ownership: the three homes

Every piece of "how it works" lives in exactly one of three places, decided by two
questions in order:

1. *Does the agent need this in context at all?* If not → it lives in **glin's
   code** (e.g. the `index.md` byte format, the search index format, fetch
   internals).
2. If yes, *is it the same across all KBs?* If yes → **`SYSTEM.md`** (tool-owned,
   ships with glin, safe to overwrite on upgrade). If KB-specific → **the KB's
   `AGENTS.md`** (human-owned, never overwritten).

The operative test is **ownership: who may overwrite the file.** This makes
`glin upgrade` able to refresh `SYSTEM.md` and skills safely while never touching a
KB's `AGENTS.md`. It also means anything the tools depend on (layout, the core
frontmatter keys, link mechanics) is invariant and lives in `SYSTEM.md`, not
per-KB config — we chose convention over parameterizing the tool on these.

---

## 6. Instruction & config files

- **`SYSTEM.md`** (ships with glin; shared invariants; overwritten on upgrade).
  Holds the tier model, directory layout, node types, frontmatter schema, link and
  provenance mechanics, the navigation/retrieval model, media placement, and the
  tool manifest. Kept reasonably lean because it is always resident.
- **KB `AGENTS.md`** (per-KB; human-owned; never overwritten). A thin layer:
  topic/purpose/scope, the emergent organization of that KB's `wiki/`, any per-KB
  frontmatter extensions, the source-image eager/lazy policy, key-source
  inventory, and working notes.

Detailed *procedures* (fetching, extracting, curating, health checks) live in
**skills**, loaded on demand, not in the always-resident prompts.

---

## 7. Tech stack & repo conventions

- **TypeScript / Node**, chosen to share a toolchain with Pi so the CLI and a
  future Pi extension can share code and glin can be embedded via Pi's SDK later.
- **One binary, subcommands:** `glin fetch | read | search | reindex | backlinks |
  init | upgrade`. One thing to install and version; one `--help` surface.
- **Thin commands over a reusable `lib/`.** Subcommands are wrappers; the logic
  lives in library functions so the same logic is reusable when glin is embedded.
- **Language-agnostic invocation.** The agent calls glin by shelling out, so every
  command must be legible and usable from a plain terminal with clear `--help`.
- **Few dependencies; sensible defaults.** Local dev via `npm link` so edits go
  live without reinstalling.

Intended repo layout:

```
glin/
  package.json          bin: { glin: dist/cli.js }
  src/
    cli.ts              arg parsing + dispatch
    commands/           one file per subcommand
    lib/                reusable logic (fetch/clean, frontmatter, …)
  templates/            stamped into new KBs by `glin init`
    SYSTEM.md
    AGENTS.md           the KB skeleton
    skills/
  extension/            Pi integration (later)
  docs/                 this document lives here
```

---

## 8. Command surface

### 8.1 stdout / stderr convention

A convention worth applying to every command: if a command's product is a
**document**, print it raw to stdout (`read`); if its product is a **record of an
action**, print JSON to stdout (`fetch`). Human logs/progress go to stderr, keeping
stdout cleanly machine-parseable for the calling agent. (`search` results are
arguably a record → JSON; decide deliberately when building it.)

### 8.2 Planned

- **`glin init <name>`** — stamp out a new KB (skeleton + `SYSTEM.md` + `AGENTS.md`
  skeleton + skills + `git init`). Deferred until the structure and skill set
  stabilize; it's still first-occurrence (only one KB exists).
- **`glin upgrade`** — refresh tool-owned files (`SYSTEM.md`, skills) in an
  existing KB without touching its `AGENTS.md`. (Note: `init` is for *new* KBs;
  getting updated skills into an *existing* KB is `upgrade`'s job, or a manual
  copy for now.)
- **`glin read <url>`** — read a single article from the web to stdout.
- **`glin fetch <url>`** — fetch a single article from the web into `raw/`.
- **`glin reindex`** — regenerate `index.md` files from frontmatter summaries.
- **`glin backlinks`** — rebuild the backlinks cache.
- **`glin search <query>`** — query the search index over the KB.

---

## 9. Skills

Skills are Pi capability packages — on-demand, progressively-disclosed prompt
packages (a `SKILL.md` plus optional files) loaded only when relevant, so detailed
procedures don't burden always-resident context. They live in glin's
`templates/skills/` (tool-owned, shipped, refreshed by `upgrade`) and are stamped
into KBs.

Planned skills:

- **Fetch articles**. Encodes the "ingest a listing page's articles"
  routine: its number-one job is the **routing rule** — use `glin read` for the
  index/reference pages, `glin fetch` only for articles being added as sources,
  and *never* fetch the index page.
- **Extraction** (next, not yet designed). Turns a `raw/` archive into a `sources/`
  node — the first point where the agent's judgment does the real work, consuming
  `meta.json` and the now-cleaner HTML.
- **Curation / index authoring, health-checks / "linting"** (future). Maintaining
  the wiki, rolling up indexes, finding inconsistencies, imputing gaps, proposing
  new article candidates and connections.

---

## 10. Workflows

The end-to-end loop, mostly agent-driven:

1. **Fetch.** Read an index page, select article links, confirm, fetch each into
   `raw/`.
2. **Extract.** Turn raw archives into faithful `sources/` nodes (extraction
   skill).
3. **Curate.** Summarize, write and organize wiki articles, cite sources, maintain
   indexes and links.
4. **Q&A.** Ask complex questions against the KB; the agent navigates
   structurally and reads what it needs.
5. **Output.** Render answers as markdown, slides (e.g. Marp), or plots rather than
   terminal text.
6. **Write-back.** File useful outputs back into the wiki so explorations "add up"
   and enhance future queries.
7. **Health checks.** Periodic LLM passes for data integrity and new-connection
   discovery.

---

## 11. Deferred & future directions

Deliberately not built yet, with the seam that anticipates each:

- **`glin init` / `glin upgrade`** — deferred until the template/structure
  stabilizes; the ownership model already makes them safe to add later.
- **Extraction and curation skills** — extraction is the immediate next piece.
- **Media ingestion (PDF / audio / video)** — currently reported in `linked_media`
  but not downloaded. Audio/video will need their own extraction (ASR for audio →
  a transcript that becomes the retained "raw" for that source, since keeping the
  heavy original is optional). A non-HTML target URL (e.g. a direct PDF link)
  currently causes `fetch` to stop cleanly; handling those is a later addition.
- **A mechanical link-extraction mode** — intentionally *not* added; first confirm
  whether a stripped `read` of an index is small enough for the agent to read
  directly. Recurring difficulty there is the signal to build it.
- **Embedding / vector search** — only if structural retrieval proves insufficient.
- **A custom top-level binary and/or web UI** — via Pi's SDK/RPC. Reading and
  rendering can be fully static; only write-back and curation need something
  running, and that "something" is currently the on-demand Pi agent, not a
  persistent server. A server with a web front-end is optional sugar layered on
  top, deferred until the CLI-plus-TUI loop reveals what it actually needs.
- **Obsidian (or other) as a viewer** — a strong candidate for browsing the
  rendered KB, consistent with Karpathy's setup; not required by the design.
- **Synthetic data generation / fine-tuning** — Karpathy's far-future idea of
  putting the KB "into the weights"; noted, not pursued.
- **Publishing glin for others** — a latent ambition; the tooling/data separation
  and convention discipline keep this open without front-loading it.
