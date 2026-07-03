import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Absolute path to the installed glin package root (contains templates/, dist/, …). */
export const PACKAGE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
