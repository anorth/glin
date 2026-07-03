# glin

Command-line tool for building local, LLM-curated knowledge bases. glin handles the mechanical work — fetching, indexing, search — while an agent (via Pi) does the reading, writing, and curation.

This repo is the **tool**. Knowledge bases themselves are separate data repositories.

Inspired by Karpathy: https://x.com/karpathy/status/2039805659525644595

## Requirements

Node.js 22 or later.

## Install

```bash
npm install
npm run build
npm link   # puts `glin` on PATH
```

## Commands

```
glin init [dir]    initialize a new knowledge base
glin fetch <url>   download and archive a page to raw/
```

See `AGENTS.md` for architecture and conventions.

## Development

```bash
npm run dev    # compile with watch
npm run lint
```

Agent-facing KB conventions live in `templates/` and are stamped into new knowledge bases by `glin init`.
