/**
 * CORS for runtime endpoints called from the dashboard (other port) or the extension.
 * Dev: any chrome-extension:// origin and any localhost port. Pin the extension id before going beyond localhost.
 */
const ALLOWED_ORIGINS = [/^chrome-extension:\/\/[a-z]+$/, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.some((re) => re.test(origin))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

/** Use as `export const OPTIONS = preflight;` in a route handler. */
export function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}
