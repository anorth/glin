import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentHashBasename,
  resolveHashFilename,
  suffixHashFilename,
} from "./hash-filename.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_HASH = "c414cd0e204de974";

describe("contentHashBasename", () => {
  it("hash plus extension", () => {
    expect(contentHashBasename(PNG, "png")).toBe(`${PNG_HASH}.png`);
  });

  it("extensionless", () => {
    expect(contentHashBasename(PNG, null)).toBe(PNG_HASH);
  });
});

describe("suffixHashFilename", () => {
  it("before extension", () => {
    expect(suffixHashFilename(`${PNG_HASH}.png`, 2)).toBe(`${PNG_HASH}-2.png`);
  });

  it("extensionless basename", () => {
    expect(suffixHashFilename(PNG_HASH, 3)).toBe(`${PNG_HASH}-3`);
  });
});

describe("resolveHashFilename", () => {
  let assetDir: string | undefined;

  afterEach(async () => {
    if (assetDir) {
      await rm(assetDir, { recursive: true, force: true });
      assetDir = undefined;
    }
  });

  it("suffixes truncated-hash collisions when content differs", async () => {
    assetDir = await mkdtemp(join(tmpdir(), "glin-hash-collision-"));
    const basename = `${PNG_HASH}.png`;
    const otherBody = Buffer.from("different bytes");
    await writeFile(join(assetDir, basename), otherBody);

    const resolved = await resolveHashFilename(assetDir, basename, PNG);
    expect(resolved).toBe(`${PNG_HASH}-2.png`);
  });

  it("reuses existing file when content matches", async () => {
    assetDir = await mkdtemp(join(tmpdir(), "glin-hash-dedup-"));
    const basename = `${PNG_HASH}.png`;
    await writeFile(join(assetDir, basename), PNG);

    const resolved = await resolveHashFilename(assetDir, basename, PNG);
    expect(resolved).toBe(basename);
  });
});
