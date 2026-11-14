import "server-only";

/**
 * All runtime limits in one place. Every value can be overridden via env (see .env.example / RUNTIME.md).
 * Counters are in-memory per server process.
 */
const num = (name: string, fallback: number) => {
  const v = process.env[name];
  return v && Number.isFinite(Number(v)) ? Number(v) : fallback;
};

export const LIMITS = {
  /** Requests per minute per caller (user id, else x-lotse-session). */
  perMinute: {
    ask: num("LOTSE_LIMIT_ASK_PER_MIN", 20),
    decide: num("LOTSE_LIMIT_DECIDE_PER_MIN", 6),
    events: num("LOTSE_LIMIT_EVENTS_PER_MIN", 6),
    /** Voice sessions per minute per session — one Live token = one spoken question (not LLM tokens). */
    voice: num("LOTSE_LIMIT_LIVE_TOKENS_PER_MIN", 8),
    /** /feedback + /prefs */
    prefs: num("LOTSE_LIMIT_PREFS_PER_MIN", 20),
  },
  /** Global caps per minute across all callers (protect the Gemini key). */
  globalPerMinute: {
    ask: num("LOTSE_LIMIT_GLOBAL_PER_MIN", 300),
    decide: num("LOTSE_LIMIT_GLOBAL_PER_MIN", 300),
    events: num("LOTSE_LIMIT_GLOBAL_PER_MIN", 300),
    voice: num("LOTSE_LIMIT_LIVE_TOKENS_GLOBAL_PER_MIN", 60),
    prefs: num("LOTSE_LIMIT_GLOBAL_PER_MIN", 300),
  },
  /** LLM tokens (input + output, ask + decide) per caller per UTC day. */
  dailyTokens: num("LOTSE_DAILY_TOKEN_BUDGET", 200_000),
  maxBodyBytes: 256 * 1024,
  questionChars: 500,
  maxElements: 300,
  labelChars: 80,
} as const;

export type GuardKind = keyof typeof LIMITS.perMinute;
