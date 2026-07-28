/**
 * Shared concurrency limiting, request-rate throttling and retry/backoff
 * helpers for external calls made during a research run (Firecrawl + LLM).
 *
 * Everything is configurable through environment variables so throughput can
 * be tuned without a code change:
 *
 *   FIRECRAWL_CONCURRENCY        (default 3)   max in-flight Firecrawl calls
 *   FIRECRAWL_RPM                (default 40)  max Firecrawl calls per minute
 *   FIRECRAWL_MAX_RETRIES        (default 6)
 *   LLM_CONCURRENCY              (default 4)   max in-flight model calls
 *   LLM_RPM                      (default 120) max model calls per minute
 *   LLM_MAX_RETRIES              (default 4)
 *   ENRICH_CONCURRENCY           (default 5)   parallel exhibitors per event
 *   RETRY_BASE_DELAY_MS          (default 800)
 *   RETRY_MAX_DELAY_MS           (default 70000)
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type LimiterConfig = {
  concurrency: number;
  requestsPerMinute: number;
  maxRetries: number;
};

/** Concurrency gate + sliding-window rate limiter. */
export class RateLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private timestamps: number[] = [];
  /** Hard global pause (epoch ms) applied when the provider reports a reset time. */
  private pausedUntil = 0;

  constructor(
    public readonly name: string,
    private config: LimiterConfig,
  ) {}

  get concurrency() {
    return this.config.concurrency;
  }

  get maxRetries() {
    return this.config.maxRetries;
  }

  /** Allows per-run overrides (e.g. a "slow mode" toggle on the run form). */
  configure(partial: Partial<LimiterConfig>) {
    this.config = { ...this.config, ...partial };
  }

  private async acquireSlot(): Promise<void> {
    if (this.active >= this.config.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** Pause every request in this limiter until the given epoch ms. */
  pauseUntil(ts: number) {
    if (ts > this.pausedUntil) this.pausedUntil = ts;
  }

  private async waitForPause(): Promise<void> {
    for (;;) {
      const wait = this.pausedUntil - Date.now();
      if (wait <= 0) return;
      await sleep(Math.min(wait, 5_000));
    }
  }

  /** Wait until another request fits inside the rolling per-minute window. */
  private async waitForWindow(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
      if (this.timestamps.length < this.config.requestsPerMinute) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      await sleep(Math.max(50, 60_000 - (now - oldest)));
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      await this.waitForPause();
      await this.waitForWindow();
      return await fn();
    } finally {
      this.release();
    }
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof RateLimitError) return error.status;
  const e = error as { status?: number; statusCode?: number; response?: { status?: number } };
  return e?.status ?? e?.statusCode ?? e?.response?.status;
}

/** 429, 408, 5xx and transient network failures are worth retrying. */
export function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429 || status === 408 || status === 409) return true;
  if (status && status >= 500) return true;
  if (status && status >= 400) return false;
  const msg = String((error as Error)?.message ?? "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    /\b5\d\d\b/.test(msg)
  );
}

export function retryAfterMsOf(error: unknown): number | undefined {
  if (error instanceof RateLimitError && error.retryAfterMs) return error.retryAfterMs;
  return undefined;
}

const BASE_DELAY = () => num("RETRY_BASE_DELAY_MS", 800);
const MAX_DELAY = () => num("RETRY_MAX_DELAY_MS", 70_000);

/** Exponential backoff with full jitter, honouring Retry-After when present. */
export function backoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, MAX_DELAY());
  const exp = Math.min(BASE_DELAY() * 2 ** attempt, MAX_DELAY());
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

export type RetryOptions = {
  maxRetries?: number;
  label?: string;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 4;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryable(error)) throw error;
      const delayMs = backoffDelay(attempt, retryAfterMsOf(error));
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error });
      console.warn(
        `[retry] ${opts.label ?? "request"} attempt ${attempt + 1}/${maxRetries} in ${delayMs}ms: ${
          (error as Error)?.message ?? error
        }`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** Limiter + retry in one call. */
export async function guarded<T>(
  limiter: RateLimiter,
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  return withRetry(() => limiter.run(fn), {
    maxRetries: limiter.maxRetries,
    label: limiter.name,
    ...opts,
    onRetry: (info) => {
      // A provider-reported reset time pauses the whole limiter, so parallel
      // workers stop hammering the API until the window actually resets.
      const ra = retryAfterMsOf(info.error);
      if (ra && ra > 0) limiter.pauseUntil(Date.now() + Math.min(ra, 120_000));
      opts.onRetry?.(info);
    },
  });
}

export const firecrawlLimiter = new RateLimiter("firecrawl", {
  concurrency: num("FIRECRAWL_CONCURRENCY", 3),
  requestsPerMinute: num("FIRECRAWL_RPM", 40),
  maxRetries: num("FIRECRAWL_MAX_RETRIES", 6),
});

export const llmLimiter = new RateLimiter("llm", {
  concurrency: num("LLM_CONCURRENCY", 4),
  requestsPerMinute: num("LLM_RPM", 120),
  maxRetries: num("LLM_MAX_RETRIES", 4),
});

export function enrichConcurrency(override?: number | null): number {
  if (override && Number.isFinite(override) && override > 0) return Math.min(Math.floor(override), 20);
  return Math.min(num("ENRICH_CONCURRENCY", 5), 20);
}

/** Runs items through a worker pool of the given size, preserving input order. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()),
  );
  return results;
}
