---
name: extract
description: >
  Extract fetched articles from raw/ into faithful sources/ markdown nodes.
  Use after articles have been archived with glin fetch, or whenever the user
  asks to extract, ingest into sources, or turn a raw archive into a source.
---

# Extract sources from raw archives

## When to use

After one or more articles have been fetched into `raw/` and the user wants them as cite-able `sources/` nodes.
Extraction is a separate step from fetching — do not extract unless asked, or unless the user asked you to continue past fetch.

## How

Use the **`extract` tool** (glin Pi extension). Do not extract yourself (no HTML parsing, scripts, or hand-written sources).

```
extract({
  archive: "raw/<domain>/[<group>/]<slug>",
  output: "sources/<…>/<Title>.md"
})
```

- `archive` — KB-relative `raw/…` directory (tool reads it; you do not pass file contents)
- `output` — KB-relative path under `sources/`, **title-based** filename (not a URL slug);
  place per wiki conventions for material shape; prefer minimal punctuation in the name
- Frontmatter `id` stays `src-<slug>` from the archive’s final path component — not from the title

Re-extract overwrites by default; don’t ask or warn.

## Raw articles

`raw/` is typically `<domain>/[<group>/]<slug>/`. There may be many archives and many files
per archive — traverse carefully (patterns/globs).

## Output

Report status to the user; don’t verify by listing or reading the written sources.
A simple list of article titles is enough; more detail only for errors.
If the tool reports token counts or cost, pass those through.

## Batch

Call `extract` once per archive.

## Scope

Extraction into `sources/` only — not fetch, wiki, or indexes — unless explicitly asked.
