import "server-only";

/**
 * All runtime limits in one place. Every value can be overridden via env (see .env.example / RUNTIME.md).
 * Counters are in-memory per server process.
 */
const num = (name: string, fallback: number) => {
  const v = process.env[name];
  return v && Number.isFinite(Number(v)) ? Number(v) : fallback;
};

const KB = 1024;
const GLOBAL = num("LOTSE_LIMIT_GLOBAL_PER_MIN", 300);

export const LIMITS = {
  /**
   * Requests per minute per caller (user id, else x-lotse-session).
   * Staged pipeline (D-23): one observation cycle = /state → /intent → /decide, sequential, coalesced ~1 s by the
   * extension → ≤ ~30 cycles/min in bursts. 60/min per stage leaves headroom without letting a loop run away.
   */
  perMinute: {
    ask: num("LOTSE_LIMIT_ASK_PER_MIN", 20),
    state: num("LOTSE_LIMIT_STATE_PER_MIN", 60),
    intent: num("LOTSE_LIMIT_INTENT_PER_MIN", 60),
    decide: num("LOTSE_LIMIT_DECIDE_PER_MIN", 60),
    events: num("LOTSE_LIMIT_EVENTS_PER_MIN", 6),
    /** Voice sessions per minute per session — one Live token = one spoken question (not LLM tokens). */
    voice: num("LOTSE_LIMIT_LIVE_TOKENS_PER_MIN", 8),
    /** /feedback + /prefs */
    prefs: num("LOTSE_LIMIT_PREFS_PER_MIN", 20),
  },
  /** Global caps per minute across all callers (protect the Gemini key). */
  globalPerMinute: {
    ask: GLOBAL,
    state: GLOBAL,
    intent: GLOBAL,
    decide: GLOBAL,
    events: GLOBAL,
    voice: num("LOTSE_LIMIT_LIVE_TOKENS_GLOBAL_PER_MIN", 60),
    prefs: GLOBAL,
  },
  /** LLM tokens (input + output; state + intent + decide + ask) per caller per UTC day. ~8 k per observation cycle. */
  dailyTokens: num("LOTSE_DAILY_TOKEN_BUDGET", 2_000_000),
  /**
   * Request body caps per route (bytes) → 413. /ask carries ≤ 4 screenshots (≤ 600 k chars each) + history;
   * /intent and /decide carry the image-free history (≤ 13 DOM states, ~350 KB worst case); everything else stays small.
   */
  maxBodyBytes: {
    default: 256 * KB,
    state: 256 * KB,
    intent: 1024 * KB,
    decide: 1024 * KB,
    ask: 4096 * KB,
  },
  questionChars: 500,
  maxElements: 300,
  labelChars: 80,
} as const;

/**
 * Model call timeouts (ms). The extension aborts every request after 20 s, so every route must answer well below that:
 * /ask = context lookup (≤ 2 s) + tier classifier (≤ 1.5 s) + tier run (≤ 15 s).
 */
export const TIMEOUTS = {
  state: num("LOTSE_TIMEOUT_STATE_MS", 6_000),
  intent: num("LOTSE_TIMEOUT_INTENT_MS", 8_000),
  /** Decisions API call; the lite fallback gets the same budget again. */
  decide: 2_500,
} as const;

export type GuardKind = keyof typeof LIMITS.perMinute;
export type BodyKind = keyof typeof LIMITS.maxBodyBytes;
