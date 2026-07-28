// Shared cache for Firecrawl scrape/search results.
// Two layers: an in-process LRU-ish map (fast, survives retries within a run)
// and a Postgres table (survives across runs / server instances).

type CacheRow = { response: unknown; expires_at: string; created_at: string };

const MEM_MAX = 300;
const mem = new Map<string, { value: unknown; expiresAt: number; storedAt: number }>();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function cacheTtlMs(kind: "scrape" | "search"): number {
  const hours =
    kind === "scrape"
      ? envInt("FIRECRAWL_SCRAPE_CACHE_HOURS", 24)
      : envInt("FIRECRAWL_SEARCH_CACHE_HOURS", 72);
  return hours * 60 * 60 * 1000;
}

export function cacheDisabled(): boolean {
  return process.env.FIRECRAWL_CACHE_DISABLED === "true";
}

export async function cacheKey(kind: string, payload: unknown): Promise<string> {
  const raw = `${kind}:${stableStringify(payload)}`;
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${kind}:${hex}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function memGet(key: string): unknown | undefined {
  const hit = mem.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    mem.delete(key);
    return undefined;
  }
  // refresh recency
  mem.delete(key);
  mem.set(key, hit);
  return hit.value;
}

function memSet(key: string, value: unknown, ttlMs: number) {
  if (mem.size >= MEM_MAX) {
    const oldest = mem.keys().next().value as string | undefined;
    if (oldest) mem.delete(oldest);
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlMs, storedAt: Date.now() });
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * @param maxAgeMs when set, entries fetched longer ago than this are ignored
 *        (the "reuse window" a re-run asks for), even if not expired yet.
 */
export async function cacheGet<T>(key: string, maxAgeMs?: number): Promise<T | undefined> {
  if (cacheDisabled()) return undefined;
  const memHit = mem.get(key);
  if (memHit && maxAgeMs !== undefined && Date.now() - memHit.storedAt > maxAgeMs) {
    mem.delete(key);
  } else {
    const hit = memGet(key);
    if (hit !== undefined) return hit as T;
  }
  try {
    const db = await admin();
    const { data } = await db
      .from("firecrawl_cache" as never)
      .select("response, expires_at, created_at")
      .eq("cache_key", key)
      .maybeSingle();
    const row = data as CacheRow | null;
    if (!row) return undefined;
    const expiresAt = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;
    if (maxAgeMs !== undefined) {
      const createdAt = Date.parse(row.created_at);
      if (Number.isFinite(createdAt) && Date.now() - createdAt > maxAgeMs) return undefined;
    }
    memSet(key, row.response, expiresAt - Date.now());
    return row.response as T;
  } catch {
    return undefined;
  }
}

export async function cacheSet(
  key: string,
  kind: string,
  request: unknown,
  response: unknown,
  ttlMs: number,
): Promise<void> {
  if (cacheDisabled()) return;
  memSet(key, response, ttlMs);
  try {
    const db = await admin();
    await db.from("firecrawl_cache" as never).upsert(
      {
        cache_key: key,
        kind,
        request: request as never,
        response: response as never,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      } as never,
      { onConflict: "cache_key" },
    );
  } catch {
    // cache writes are best-effort
  }
}

export type CacheOptions = {
  /** Ignore entries fetched longer ago than this (the reuse window). */
  maxAgeMs?: number;
  /** Override how long a fresh entry stays usable. */
  ttlMs?: number;
  /** Skip the cache entirely for this call. */
  bypass?: boolean;
};

/** Wrap a Firecrawl call with read-through caching. */
export async function withCache<T>(
  kind: "scrape" | "search",
  request: unknown,
  fn: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<{ value: T; cached: boolean }> {
  const key = await cacheKey(kind, request);
  if (!opts.bypass) {
    const hit = await cacheGet<T>(key, opts.maxAgeMs);
    if (hit !== undefined) return { value: hit, cached: true };
  }
  const value = await fn();
  await cacheSet(key, kind, request, value, opts.ttlMs ?? cacheTtlMs(kind));
  return { value, cached: false };
}
