---
name: fetch-articles
description: >
  Fetch articles from the web into raw/, either individually or from an index, listing, or archive page —
  a blog's post list, an author page, a publication front page.
  Use whenever the user wants to fetch, collect, or ingest articles or posts.
  Covers reading the index page, selecting which links to fetch (honouring any
  include / skip / section constraints), confirming the list, and fetching each
  with `glin fetch`.
---

# Fetch articles

## Fetching a single article

Use this when the user points you at a **single** article URL and wants it fetched.

- Use `glin fetch <url>` to fetch the article.

This will persist the article to disk in `raw/`, from where content may subsequently be extracted into `sources/`.

## Fetching multiple articles from an index or directory page

Use this when the user points you at an index / listing / archive page and wants
many of the articles it links to be fetched.

### Routing: read vs fetch (the key rule)

- Use **`glin read <url>`** for the index page and any page you only need to look
  at — reference pages, checking where a link goes. `read` persists nothing,
  strips `<script>` and `<style>`, and returns absolute links, so it's the right
  tool for inspecting a listing.
- Use **`glin fetch <url>`** only for the articles you are adding to the knowledge base.
  `fetch` writes to `raw/`.
- **Never `glin fetch` the index page.** It is not a source; fetching it leaves an
  unwanted archive in `raw/` and hands more data than you need. Read it instead.

### Steps

1. **Read the index.** `glin read <index-url>`. The result is already stripped and
   has absolute links — read it directly and pull the article links from it. You
   should not need to write parsing scripts; if the listing is unusually large,
   read it in parts rather than building extraction tooling.
2. **Select the article links.** Identify the links that point to individual
   articles or posts (usually individual pages on the same domain). Ignore
   navigation, pagination, category/tag pages, and social or external links. Apply
   any constraints the user gave — specific items to skip, sections to include or
   exclude. If the listing is organised under headings or
   sections, use them to honour section-based constraints.
3. **Confirm before fetching.** Present the selected list (grouped by section if
   the index is, with URLs) and stop for the user to confirm or adjust. Do not
   fetch the whole set until they have okayed the list — a bulk fetch is worth a
   checkpoint.
4. **Fetch each confirmed article.** Run `glin fetch <url>` per article. Use
   `--group <name>` when the index represents a distinct publication or author
   sharing a domain with others, so the archives nest sensibly; skip it when the
   domain is itself the publication.
5. **Report back.** Summarise what was fetched, and surface anything notable in
   each fetch's `linked_media` — PDFs, audio, or video the post links but that
   `fetch` did not download — so the user can see what is being left behind.

## User instruction precedence

The user gives instructions that specifically contravene some guidance here, follow the user's instructions.
For example, if the user requests that you do not confirm before fetching, then go ahead and fetch after selecting the article links. 

## Scope

This skill only fetches articles into `raw/`. It does not extract them into
`sources/` — that is a separate step. Stop once the articles are archived, unless
the user asks you to continue.