/**
 * Route-pattern match for the app policy (D-27), shared by server and extension. Zod-free on purpose:
 * the content script imports it via `@lotse/shared/route` without pulling the schemas into every page.
 *
 * Patterns: `*` = any characters (including `/`), case-insensitive, anchored at both ends, matched against the
 * decoded local location `pathname + search + hash` (the extension checks the full location locally — the query
 * string never leaves the browser). `*fahrzeug*` blocks `/fahrzeuge/12`, `/#/fahrzeug`, `/index.php?page=fahrzeuge`;
 * `/admin/*` blocks everything under /admin/.
 */
export function routeBlocked(location: string, patterns: readonly string[]): boolean {
  let subject = location;
  try {
    subject = decodeURIComponent(location);
  } catch {
    // malformed escape sequence: match the raw string
  }
  subject = subject.toLowerCase();
  return patterns.some((pattern) => {
    const source = pattern.trim().toLowerCase();
    if (!source) return false;
    const body = source.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${body}$`).test(subject);
  });
}
