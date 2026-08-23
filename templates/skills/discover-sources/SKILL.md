---
name: discover-sources
description: >
  Discover candidate source URLs when the user has a topic, question, author, or
  publication but no URL. Uses glin web-search, then judges results and fetches
  chosen articles. Use whenever the user wants sources, papers, or articles on a
  subject and has not pointed at a specific page or listing.
---

# Discover sources

Use this when there is a **topic** and no URL.

- Already have an article or PDF URL → `glin fetch` (see fetch-articles).
- Already have an index / listing / archive page → `glin read`, then fetch (see fetch-articles).
- Topic, question, author, or publication name only → this skill.

## How to query

`glin web-search` is backed by Exa: a semantic index, not a keyword SERP.
Write the query as a research request — what you want and why — not Google operators.

- Good: `Survey papers on retrieval-augmented generation evaluation benchmarks published since 2023`
- Bad: `RAG evaluation benchmark filetype:pdf`

Narrow with flags, not with “page 2” (there is no cursor):

- `--include-domain` / `--exclude-domain` (repeatable)
- `--start-published-date` / `--end-published-date` (ISO 8601)

If the first results are off-topic, rewrite the query or tighten filters.
Default is 20 results. Raise `--num-results` when that set is useful but incomplete.

Requires `EXA_API_KEY` in the environment.

## Steps

1. **Search.** `glin web-search "<research request>"`, adding domain or date flags when the user named venues or a window.
2. **Judge.** Pick URLs from titles and snippets. Discard listicles, SEO pages, and off-topic hits.
3. **Confirm** the shortlist when it is more than a couple of URLs. Stop for the user unless they said not to.
4. **Fetch** each chosen URL with `glin fetch <url>`. Use `--group` when several sources share a domain but not a publication.

## Boundary

Snippets, titles, and highlights are **triage only**. Never copy them into `raw/` or `sources/`.
Archive a chosen URL with `glin fetch`; extract from that archive if asked.
