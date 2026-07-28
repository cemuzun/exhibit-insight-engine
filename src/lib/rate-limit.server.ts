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
 *   BREAKER_FAILURE_THRESHOLD    (default 3)   rate-limit hits before tripping
 *   BREAKER_COOLDOWN_MS          (default 30000) cooldown when the provider
 *                                                gives us no reset time
 *   BREAKER_MAX_COOLDOWN_MS      (default 180000)
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

/**
 * closed    — normal operation
 * open      — every worker is held; the provider told us (or we inferred) to stop
 * half_open — cooldown elapsed; exactly one probe request is allowed through
 */
export type BreakerState = "closed" | "open" | "half_open";

export type BreakerEvent = {
  limiter: string;
  state: BreakerState;
  /** epoch ms the breaker expects to allow traffic again (open state only) */
  resumeAt?: number;
  reason?: string;
};

/** Concurrency gate + sliding-window rate limiter. */
export class RateLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private timestamps: number[] = [];
  /** Hard global pause (epoch ms) applied when the provider reports a reset time. */
  private pausedUntil = 0;

  // ---- circuit breaker ----
  // Retrying individual requests is not enough: with N parallel workers, a
  // provider-wide 429 turns into N independent backoff loops that all keep
  // poking the API. The breaker is shared state, so one rate limit stops
  // everyone, and a single probe decides when it is safe to resume.
  private breaker: BreakerState = "closed";
  private consecutiveRateLimits = 0;
  private openUntil = 0;
  private cooldownMs = 0;
  private probeInFlight = false;
  private listeners = new Set<(e: BreakerEvent) => void>();

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

  get breakerState(): BreakerState {
    return this.breaker;
  }

  /** epoch ms when an open breaker expects to let traffic through again. */
  get resumeAt(): number {
    return this.openUntil;
  }

  /** Subscribe to breaker transitions (used to surface pauses in run progress). */
  onBreakerChange(fn: (e: BreakerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(state: BreakerState, reason?: string) {
    const event: BreakerEvent = {
      limiter: this.name,
      state,
      ...(state === "open" ? { resumeAt: this.openUntil } : {}),
      ...(reason ? { reason } : {}),
    };
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // A misbehaving listener must never break the request path.
      }
    }
  }

  /**
   * Report a rate limit (or repeated overload). Once the threshold is crossed
   * the breaker opens and every worker parks until the reset time.
   */
  reportRateLimited(retryAfterMs?: number, reason?: string) {
    this.consecutiveRateLimits++;
    const threshold = num("BREAKER_FAILURE_THRESHOLD", 3);
    const base = num("BREAKER_COOLDOWN_MS", 30_000);
    const max = num("BREAKER_MAX_COOLDOWN_MS", 180_000);

    // A failed probe means the provider is still limiting: back off harder.
    if (this.breaker === "half_open") {
      this.cooldownMs = Math.min(Math.max(this.cooldownMs * 2, base), max);
    } else if (this.consecutiveRateLimits >= threshold) {
      this.cooldownMs = Math.min(Math.max(retryAfterMs ?? base, base), max);
    } else {
      return;
    }

    const until = Date.now() + Math.min(Math.max(retryAfterMs ?? this.cooldownMs, this.cooldownMs), max);
    this.openUntil = Math.max(this.openUntil, until);
    this.probeInFlight = false;
    if (this.breaker !== "open") {
      this.breaker = "open";
      this.emit("open", reason ?? "provider rate limit");
    }
  }

  /** A completed request proves the provider is healthy again. */
  reportSuccess() {
    this.consecutiveRateLimits = 0;
    if (this.breaker !== "closed") {
      this.breaker = "closed";
      this.openUntil = 0;
      this.cooldownMs = 0;
      this.probeInFlight = false;
      this.emit("closed");
    }
  }

  /**
   * Hold the caller while the breaker is open. When the cooldown expires the
   * first caller through becomes the probe; the rest keep waiting until that
   * probe either closes the breaker or re-opens it.
   */
  private async waitForBreaker(): Promise<void> {
    for (;;) {
      if (this.breaker === "closed") return;

      const remaining = this.openUntil - Date.now();
      if (remaining > 0) {
        await sleep(Math.min(remaining, 2_000));
        continue;
      }

      if (this.breaker === "open") {
        this.breaker = "half_open";
        this.probeInFlight = true;
        this.emit("half_open", "testing whether the provider recovered");
        return; // this caller is the probe
      }

      // half_open: someone else is probing.
      if (!this.probeInFlight) {
        this.probeInFlight = true;
        return;
      }
      await sleep(500);
    }
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
      await this.waitForBreaker();
      await this.waitForPause();
      await this.waitForWindow();
      const result = await fn();
      this.reportSuccess();
      return result;
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

/** Narrower than isRetryable: only provider throttling should trip the breaker. */
export function isRateLimit(error: unknown): boolean {
  if (statusOf(error) === 429) return true;
  const msg = String((error as Error)?.message ?? "").toLowerCase();
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests");
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
      if (isRateLimit(info.error)) {
        limiter.reportRateLimited(ra, (info.error as Error)?.message);
      }
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
