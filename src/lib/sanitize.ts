/** Strip leading www. and sanitize a hostname for use as a directory name. */
export function sanitizeDomain(hostname: string): string {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  return sanitizePathComponent(host);
}

/** Sanitize a single path component (slug, group name, filename). */
export function sanitizePathComponent(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || "unnamed";
}

/** Derive a page slug from a URL pathname. */
export function slugFromUrl(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    return "index";
  }

  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  const slug = segments.join("-");
  return sanitizePathComponent(slug.toLowerCase());
}

/** Sanitize a filename while preserving its extension when possible. */
export function sanitizeFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "file";
  }

  const dot = trimmed.lastIndexOf(".");
  if (dot > 0 && dot < trimmed.length - 1) {
    const base = sanitizePathComponent(trimmed.slice(0, dot));
    const ext = trimmed
      .slice(dot + 1)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    return ext ? `${base}.${ext}` : base;
  }

  return sanitizePathComponent(trimmed);
}

/** Final URL path segment, sanitized for use as an on-disk filename. */
export function filenameFromUrlPath(url: string, fallback: string): string {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (last) {
      const withoutQuery = decodeURIComponent(last.split("?")[0] ?? last);
      const sanitized = sanitizeFilename(withoutQuery);
      if (sanitized !== "file") {
        return sanitized;
      }
    }
  } catch {
    // fall through
  }
  return sanitizeFilename(fallback);
}

/** Append -2, -3, … before the extension when filename is already taken. */
export function uniquifyFilename(filename: string, usedNames: Map<string, number>): string {
  const count = usedNames.get(filename) ?? 0;
  usedNames.set(filename, count + 1);
  if (count === 0) {
    return filename;
  }

  const dot = filename.lastIndexOf(".");
  if (dot > 0) {
    return `${filename.slice(0, dot)}-${count + 1}${filename.slice(dot)}`;
  }
  return `${filename}-${count + 1}`;
}
