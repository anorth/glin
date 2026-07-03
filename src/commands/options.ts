/** Parse a commander `<yes|no>` option value into a boolean. */
export function parseYesNo(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower === "yes") {
    return true;
  }
  if (lower === "no") {
    return false;
  }
  throw new Error(`expected yes or no, got ${value}`);
}
