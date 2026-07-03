import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireBaseDir, resolveBaseDir } from "./kb.js";

describe("resolveBaseDir", () => {
  it("returns cwd when baseDir is omitted", () => {
    expect(resolveBaseDir()).toBe(process.cwd());
  });

  it("resolves relative baseDir against cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glin-kb-test-"));
    expect(resolveBaseDir(dir)).toBe(dir);
  });
});

describe("requireBaseDir", () => {
  it("throws when raw/ is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glin-kb-test-"));
    expect(() => requireBaseDir(dir)).toThrow(/raw\/ directory not found/);
    expect(() => requireBaseDir(dir)).toThrow(/--base-dir/);
  });

  it("returns the base dir when raw/ exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glin-kb-test-"));
    await mkdir(join(dir, "raw"), { recursive: true });
    expect(requireBaseDir(dir)).toBe(dir);
  });
});
