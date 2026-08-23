# AGENTS.md — «Knowledge Base Name»

<!--
This file is yours outside the delimited glin-managed block at the bottom.
Fill in the «placeholders» and grow the human-owned sections as the KB develops.
`glin upgrade` may refresh only the BEGIN/END GLIN block; it never overwrites
anything above those markers.
-->

## Topic, purpose, scope

- **Topic:** «e.g. education technology research — evidence and theory on teaching and learning»
- **Purpose:** «what you use it for — e.g. planning and informing independent edtech research projects»
- **Scope:** «the boundary that decides whether a new source belongs here»

## How this wiki is organized

«Start open. As structure emerges in `wiki/`, describe it here so the agent keeps
to it — the main groupings, where different kinds of node live, any conventions
particular to this subject. Leave this blank while the shape is still settling.»

## Frontmatter extensions

«Any keys or vocabularies specific to this KB, beyond the core schema in the
glin-managed block below — e.g. a controlled `tags` list, or an `evidence_level` /
`study_type` key for research nodes. Optional; omit until you need it.»

## Source-image handling

«Policy for images that arrive with a source: reference them in place under
`raw/…/images/` (lazy), or copy the ones actually used into `assets/` and repoint
(eager). Lazy is the simpler default; go eager when you want `raw/` to be
severable — e.g. before evicting heavy originals.»

Default: «lazy»

## Key sources

«An evolving inventory of the important sources or publications this KB draws on —
orientation for both the agent and you. Grow it as you ingest.»

## Working notes

«Open questions, things to watch for, naming quirks, ideas for articles to write
or connections to explore. Scratch space that persists with the KB.»

<!-- BEGIN GLIN -->

## Glin knowledge-base structure

This knowledge base follows the [Open Knowledge Format (OKF) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), extended by glin.
The root `index.md` declares `okf_version: "0.1"`. 
Shared structural invariants live in this managed block; do not edit between the markers — `glin upgrade` regenerates them.

### Directory layout

```
<kb-root>/
  AGENTS.md      this file (human-owned above; glin-managed block here)
  raw/           immutable fetched originals
  sources/       faithful extractions
  wiki/          working knowledge space
  assets/        pooled media store
  chats/         logs and/or summaries of interactive discussion
  index.md       top-level navigation index (`okf_version` only)
```

### `raw/` and `sources/`

- **`raw/`** — fetched originals (HTML with localized images, PDFs, media), typically under `<domain>/[<group>/]<slug>/`. Never edit.
- **`sources/`** — one faithful markdown node per article/paper/episode: main content kept, noise dropped. Cite-only; never rewrite or editorialize.

Both tiers are maintained by glin (`fetch`, `extract`). 
Do not create, edit, move, or reorganize content under `raw/` or `sources/` by hand — treat them as read-only cite targets. 
To improve a source, re-extract from its `raw/` archive via glin, rather than editing the markdown.

### `wiki/`

The fluid working knowledge space: content may come from sources, conversations, or direct writing. 
You and the user build and reorganize it; run `glin index` after you add, move, or remove nodes. 
How *this* KB organizes its wiki is described in the human-owned sections above and is expected to evolve.

### Reserved filenames

`index.md` and `log.md` are reserved at every level by OKF and are **not** concept documents — do not give them concept frontmatter or treat them as wiki/source nodes. `log.md` is optional change history; glin does not require it.

### Nodes, types, and frontmatter

Every concept is a markdown file with YAML frontmatter.
Required on every node: `type`, `title`, `description`.
A node without a good `description` is invisible to navigation.
Concept ID is the file path with the `.md` suffix removed (e.g. `wiki/methodology/effect-sizes.md` → `wiki/methodology/effect-sizes`).

- **Source nodes** (`sources/`): `type` is a descriptive content kind — `Article`, `Paper`, `Podcast`, `Video`, `Post`, `Thread`, `Report`, etc. (Title Case, open vocabulary). Also: `resource` (canonical URL), `fetched` (YYYY-MM-DD), `raw` (path to the archive); optional `author`, `publication`.
- **Wiki nodes** (`wiki/`): `type: Wiki`. Also: `timestamp` (YYYY-MM-DD of last meaningful change); optional `tags`.

Immutability follows **location**, not type: never mutate content under `sources/`; freely maintain anything under `wiki/`.
Extra frontmatter keys defined in the human-owned sections above are fine; tools ignore keys they do not recognize.

### Links and provenance

All links are markdown with readable display text and **kb-root absolute paths**, e.g. `[effect sizes](/wiki/methodology/effect-sizes.md)` or `[original](/sources/example.com/post.md)`.

- **Citations (wiki → source):** markdown links to source nodes, collected under a `# Citations` heading at the foot of the wiki node, preferably numbered — e.g. `[1] [Title](/sources/…/page.md)`. Cite the source; never paste its content; never attribute a claim a source does not support.
- **Cross-links (wiki ↔ wiki, source ↔ source):** the same form of markdown link, used inline.
- When you move or rename a node, repair every inbound link and citation as part of the move.

### Navigation (`index.md`)

Each directory has an `index.md` for progressive disclosure — read these to navigate before opening individual nodes. Listings look like:

```markdown
* [Title](<url>) - description
```

Frontmatter `description`s are the source of truth; indexes are derived views. Do not hand-edit the listings — run `glin index` (alias `reindex`) after adding, moving, or removing a node under `sources/` or `wiki/`. Prose above the listing is yours (a directory self-description); `glin index` preserves it and rolls the first prose line up to the parent.
Only the bundle-root `index.md` may hold frontmatter (`okf_version` and nothing else); subdirectory indexes carry none.

<!-- END GLIN -->
