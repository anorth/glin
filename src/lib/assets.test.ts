import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adoptSourceAssets, findInvalidSourceImageRefs } from "./assets.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_HASH = "c414cd0e204de974";

describe("adoptSourceAssets", () => {
  let kbDir: string | undefined;

  afterEach(async () => {
    if (kbDir) {
      await rm(kbDir, { recursive: true, force: true });
      kbDir = undefined;
    }
  });

  async function setupArchive(): Promise<{
    kbRoot: string;
    archivePath: string;
    imageBasename: string;
  }> {
    kbDir = await mkdtemp(join(tmpdir(), "glin-adopt-test-"));
    const kbRoot = kbDir;
    const archivePath = join(kbRoot, "raw", "example.test", "post");
    await mkdir(join(archivePath, "images"), { recursive: true });
    const imageBasename = `${PNG_HASH}.png`;
    await writeFile(join(archivePath, "images", imageBasename), PNG);
    return { kbRoot, archivePath, imageBasename };
  }

  it("copies referenced archive image into assets/", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const markdown = `![chart](images/${imageBasename})`;

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.markdown).toBe(`![chart](/assets/${imageBasename})`);
    expect(result.adopted).toEqual([imageBasename]);
    expect(result.deduplicated).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(await readFile(join(kbRoot, "assets", imageBasename))).toEqual(PNG);
  });

  it("deduplicates identical content already in assets/", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    await mkdir(join(kbRoot, "assets"), { recursive: true });
    await writeFile(join(kbRoot, "assets", imageBasename), PNG);
    const markdown = `![chart](images/${imageBasename})`;

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.markdown).toBe(`![chart](/assets/${imageBasename})`);
    expect(result.adopted).toEqual([]);
    expect(result.deduplicated).toEqual([imageBasename]);
    expect(result.errors).toEqual([]);
  });

  it("suffixes on collision and rewrites markdown ref", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const otherBody = Buffer.from("different bytes");
    await mkdir(join(kbRoot, "assets"), { recursive: true });
    await writeFile(join(kbRoot, "assets", imageBasename), otherBody);
    const markdown = `![chart](images/${imageBasename})`;
    const suffixed = `${PNG_HASH}-2.png`;

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.markdown).toBe(`![chart](/assets/${suffixed})`);
    expect(result.adopted).toEqual([suffixed]);
    expect(result.deduplicated).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(await readFile(join(kbRoot, "assets", suffixed))).toEqual(PNG);
    expect(await readFile(join(kbRoot, "assets", imageBasename))).toEqual(otherBody);
  });

  it("deduplicates onto an existing suffixed basename", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const suffixed = `${PNG_HASH}-2.png`;
    const otherBody = Buffer.from("different bytes");
    await mkdir(join(kbRoot, "assets"), { recursive: true });
    await writeFile(join(kbRoot, "assets", imageBasename), otherBody);
    await writeFile(join(kbRoot, "assets", suffixed), PNG);
    const markdown = `![chart](images/${imageBasename})`;

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.markdown).toBe(`![chart](/assets/${suffixed})`);
    expect(result.adopted).toEqual([]);
    expect(result.deduplicated).toEqual([suffixed]);
    expect(result.errors).toEqual([]);
    expect(await readFile(join(kbRoot, "assets", suffixed))).toEqual(PNG);
    expect(await readFile(join(kbRoot, "assets", imageBasename))).toEqual(otherBody);
  });

  it("missing archive image", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const otherBasename = "aaaaaaaaaaaaaaaa.png";
    await writeFile(join(archivePath, "images", otherBasename), PNG);
    const markdown = [
      `![missing](images/${imageBasename})`,
      `![ok](images/${otherBasename})`,
    ].join("\n");
    await rm(join(archivePath, "images", imageBasename));

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(
      `Archive image not found for images/${imageBasename}`,
    );
    expect(result.adopted).toEqual([PNG_HASH + ".png"]);
    expect(result.markdown).toBe([
      `![missing](images/${imageBasename})`,
      `![ok](/assets/${PNG_HASH}.png)`,
    ].join("\n"));
  });

  it("ignores links, remote, data, and blob images", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const markdown = [
      `[guide](/wiki/guide.md)`,
      `![remote](https://example.test/x.png)`,
      `![inline](data:image/png;base64,aaa)`,
      `![blob](blob:https://example.test/uuid)`,
      `![chart](images/${imageBasename})`,
    ].join("\n");

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.adopted).toEqual([imageBasename]);
    expect(result.errors).toEqual([]);
    expect(result.markdown).toBe([
      `[guide](/wiki/guide.md)`,
      `![remote](https://example.test/x.png)`,
      `![inline](data:image/png;base64,aaa)`,
      `![blob](blob:https://example.test/uuid)`,
      `![chart](/assets/${imageBasename})`,
    ].join("\n"));
  });

  it("re-hashes archive basename and dedupes identical bytes", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const otherBasename = "logo.png";
    await writeFile(join(archivePath, "images", otherBasename), PNG);
    const markdown = [
      `![one](images/${imageBasename})`,
      `![two](images/${otherBasename})`,
      `![one again](images/${imageBasename})`,
    ].join("\n");

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.adopted).toEqual([imageBasename]);
    expect(result.deduplicated).toEqual([imageBasename]);
    expect(result.errors).toEqual([]);
    expect(result.markdown).toBe([
      `![one](/assets/${imageBasename})`,
      `![two](/assets/${imageBasename})`,
      `![one again](/assets/${imageBasename})`,
    ].join("\n"));
  });

  it("nested archive-relative path", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const nestedRef = `figures/sub/${imageBasename}`;
    await mkdir(join(archivePath, "figures", "sub"), { recursive: true });
    await writeFile(join(archivePath, nestedRef), PNG);
    const markdown = `![diagram](${nestedRef})`;

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.markdown).toBe(`![diagram](/assets/${imageBasename})`);
    expect(result.adopted).toEqual([imageBasename]);
    expect(await readFile(join(kbRoot, "assets", imageBasename))).toEqual(PNG);
  });

  it("ignores absolute and escaping refs", async () => {
    const { kbRoot, archivePath, imageBasename } = await setupArchive();
    const markdown = [
      `![vault](/assets/${imageBasename})`,
      `![escape](../outside.png)`,
      `![ok](images/${imageBasename})`,
    ].join("\n");

    const result = await adoptSourceAssets({ markdown, archivePath, kbRoot });

    expect(result.adopted).toEqual([imageBasename]);
    expect(result.markdown).toBe([
      `![vault](/assets/${imageBasename})`,
      `![escape](../outside.png)`,
      `![ok](/assets/${imageBasename})`,
    ].join("\n"));
  });
});

describe("findInvalidSourceImageRefs", () => {
  let kbDir: string | undefined;

  afterEach(async () => {
    if (kbDir) {
      await rm(kbDir, { recursive: true, force: true });
      kbDir = undefined;
    }
  });

  async function setupKb(): Promise<string> {
    kbDir = await mkdtemp(join(tmpdir(), "glin-invalid-refs-"));
    await mkdir(join(kbDir, "assets"), { recursive: true });
    await writeFile(join(kbDir, "assets", `${PNG_HASH}.png`), PNG);
    return kbDir;
  }

  it("allows on-disk /assets refs", async () => {
    const kbRoot = await setupKb();
    expect(
      findInvalidSourceImageRefs(`![ok](/assets/${PNG_HASH}.png)`, kbRoot),
    ).toEqual([]);
  });

  it("allows data and blob refs", async () => {
    const kbRoot = await setupKb();
    const markdown = [
      "![d](data:image/png;base64,aaa)",
      "![b](blob:https://example.test/uuid)",
    ].join("\n");
    expect(findInvalidSourceImageRefs(markdown, kbRoot)).toEqual([]);
  });

  it("flags leftover archive-relative refs", async () => {
    const kbRoot = await setupKb();
    expect(
      findInvalidSourceImageRefs("![x](images/foo.png)", kbRoot),
    ).toEqual(["images/foo.png"]);
  });

  it("flags remote http refs", async () => {
    const kbRoot = await setupKb();
    expect(
      findInvalidSourceImageRefs("![x](https://example.test/x.png)", kbRoot),
    ).toEqual(["https://example.test/x.png"]);
  });

  it("flags missing /assets files", async () => {
    const kbRoot = await setupKb();
    expect(
      findInvalidSourceImageRefs("![x](/assets/missing.png)", kbRoot),
    ).toEqual(["/assets/missing.png"]);
  });

  it("flags /assets without leading slash", async () => {
    const kbRoot = await setupKb();
    expect(
      findInvalidSourceImageRefs(`![x](assets/${PNG_HASH}.png)`, kbRoot),
    ).toEqual([`assets/${PNG_HASH}.png`]);
  });
});
