/**
 * Per-key two-tier rate limit: short burst (10 min) + daily cap.
 *
 * In-memory Map, so counters are per-serverless-instance. Acceptable stopgap
 * for single-consumer use (one Explore server) with client-side debounce and
 * answer caching. Swap to Upstash/Vercel KV when we have multiple consumers
 * or need accuracy across a Vercel region spanning >1 lambda instance.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

interface State {
  short: Bucket;
  long: Bucket;
}

export interface RateLimitResult {
  allowed: boolean;
  scope?: 'short' | 'long';
  limit?: number;
  remaining?: number;
  retryAfterSec?: number;
}

const SHORT_WINDOW_MS = 10 * 60 * 1000; // 10 min
const SHORT_MAX = 60;
const LONG_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h
const LONG_MAX = 500;

const buckets = new Map<string, State>();

function freshState(now: number): State {
  return {
    short: { count: 0, resetAt: now + SHORT_WINDOW_MS },
    long: { count: 0, resetAt: now + LONG_WINDOW_MS },
  };
}

export function checkRateLimit(keyId: string, now: number = Date.now()): RateLimitResult {
  let state = buckets.get(keyId);
  if (!state) {
    state = freshState(now);
    buckets.set(keyId, state);
  }
  if (now >= state.short.resetAt) {
    state.short = { count: 0, resetAt: now + SHORT_WINDOW_MS };
  }
  if (now >= state.long.resetAt) {
    state.long = { count: 0, resetAt: now + LONG_WINDOW_MS };
  }

  if (state.short.count >= SHORT_MAX) {
    return {
      allowed: false,
      scope: 'short',
      limit: SHORT_MAX,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((state.short.resetAt - now) / 1000)),
    };
  }
  if (state.long.count >= LONG_MAX) {
    return {
      allowed: false,
      scope: 'long',
      limit: LONG_MAX,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((state.long.resetAt - now) / 1000)),
    };
  }

  state.short.count += 1;
  state.long.count += 1;
  return {
    allowed: true,
    limit: SHORT_MAX,
    remaining: Math.max(0, SHORT_MAX - state.short.count),
  };
}

// Test hook — do not use in production paths.
export function __resetRateLimitForTest(): void {
  buckets.clear();
}
