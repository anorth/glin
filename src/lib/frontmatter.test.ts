import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns empty data when there is no frontmatter", () => {
    const parsed = parseFrontmatter("# Hello\n\nBody\n");
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("# Hello\n\nBody\n");
  });

  it("parses title and folded description", () => {
    const parsed = parseFrontmatter(`---
type: Wiki
title: Effect Sizes
description: >
  What effect sizes mean
  and why 0.4 became a benchmark.
---

# Effect Sizes
`);
    expect(parsed.data.title).toBe("Effect Sizes");
    expect(parsed.data.description).toBe(
      "What effect sizes mean and why 0.4 became a benchmark.\n",
    );
    expect(parsed.body).toBe("\n# Effect Sizes\n");
  });

  it("treats unclosed fences as no frontmatter", () => {
    const text = "---\ntitle: No close\n\n# Body\n";
    const parsed = parseFrontmatter(text);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe(text);
  });

  it("survives invalid YAML", () => {
    const parsed = parseFrontmatter("---\n: :\n---\n\nBody\n");
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("\nBody\n");
  });
});
