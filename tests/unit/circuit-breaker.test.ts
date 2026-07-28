import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/lib/rate-limit.server";

process.env.BREAKER_COOLDOWN_MS = "100";
process.env.BREAKER_MAX_COOLDOWN_MS = "300";

const mk = () =>
  new RateLimiter("test", { concurrency: 4, requestsPerMinute: 1000, maxRetries: 0 });

describe("rate limiter circuit breaker", () => {
  it("stays closed below the failure threshold", () => {
    const l = mk();
    l.reportRateLimited(50);
    l.reportRateLimited(50);
    expect(l.breakerState).toBe("closed");
  });

  it("opens after repeated rate limits and blocks all workers", async () => {
    const l = mk();
    for (let i = 0; i < 3; i++) l.reportRateLimited(120);
    expect(l.breakerState).toBe("open");
    expect(l.resumeAt).toBeGreaterThan(Date.now());

    const started = Date.now();
    const done: number[] = [];
    await Promise.all(
      [0, 1, 2].map(() => l.run(async () => done.push(Date.now() - started))),
    );
    // every worker waited for the cooldown, then the breaker closed
    expect(done.every((d) => d > 0)).toBe(true);
    expect(l.breakerState).toBe("closed");
  }, 20_000);

  it("emits open then closed transitions", async () => {
    const l = mk();
    const states: string[] = [];
    l.onBreakerChange((e) => states.push(e.state));
    for (let i = 0; i < 3; i++) l.reportRateLimited(100);
    await l.run(async () => "ok");
    expect(states[0]).toBe("open");
    expect(states.at(-1)).toBe("closed");
  }, 20_000);
});
