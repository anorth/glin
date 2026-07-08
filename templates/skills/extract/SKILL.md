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

Use the **`subagent` tool** with agent `extract` (provided by the glin Pi extension).
The extract agent runs on a fast, pinned model with a self-contained prompt — it does not use your current model or the KB's SYSTEM.md / AGENTS.md.

For each archive, pass the archive's `index.html` and `meta.json` via `files` so they are inlined in full into the subagent's context:

```
subagent({
  agent: "extract",
  task: "Extract the archive at raw/<domain>/[<group>/]<slug> into a source markdown file",
  files: [
    "raw/<domain>/[<group>/]<slug>/meta.json",
    "raw/<domain>/[<group>/]<slug>/index.html"
  ]
})
```

Always include both files. Do not omit `files` or rely on the subagent to read the archive itself.

## Raw articles

The `raw/` directory contains the raw HTML and metadata of the archived articles, structured as `<domain>/[<group>/]<slug>/`.
There may be many raw articles and many, many files within each article directory, so traverse the `raw/` directory carefully to find the paths you need (use patterns and globs to limit output).

## What the extract agent does

- Works from the inlined `index.html` and `meta.json` you pass via `files`
- Writes `sources/<mirrored path>/<slug>.md` with required source frontmatter
  (`id`, `type: source`, `title`, `author`, `source_url`, `fetched`, `raw`, `summary`)
  and a faithful markdown body (main content only; no editorializing)
- Copies images the source actually uses into pooled `assets/` (content-hash
  dedup) and points the markdown at those paths

You do not need to perform those steps yourself — delegate and report the result.

You may be asked to re-extract articles that have already been extracted. 
Do as is requested, don't ask or warn about it.
The subagent will overwrite the existing file by default and doesn't need special instructions. 

## Output

Do *not* verify the subagent's work, simply report its status to the user.
Don't list the sources directory or read the created source files.

Output just a simple list of article titles extracted, no further metadata.
Output more detail for errors or difficulties.

If the subagent tool reports them, report the input and output token count, and cost, to the user.

## Errors

The extraction agent may report failures or errors. 
Do not attempt to handle them or correct them, simply report them to the user.
Do not attempt do to any extraction yourself. Do not attempt to parse the HTML, execute JavaScript, or write scripts to do it.

## Batch

When extracting many archives, call `subagent` once per archive. Summarise what
was written (`source` path, images adopted, any notes) when done.

## Scope

This skill only covers extraction into `sources/`.
It does not fetch pages, write wiki nodes, or update indexes — those are separate steps.
Do not attempt to do anything beyond extraction, unless explicitly asked.
