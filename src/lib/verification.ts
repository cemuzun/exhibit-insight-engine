/**
 * Event verification model (spec Phase 1).
 *
 * Pure logic only — the network/AI verification pass lives in
 * `verification.server.ts` and calls into these helpers so the rules stay
 * testable without hitting a live site.
 */

export type EventVerifiedStatus = "CONFIRMED" | "UNVERIFIED" | "STALE" | "CANCELED";

export type ExhibitorDirectoryStatus = "PUBLIC" | "GATED" | "PDF_ONLY" | "NONE" | "UNKNOWN";

export type EventVerification = {
  verified_status: EventVerifiedStatus;
  event_year: number | null;
  official_event_url: string | null;
  start_date: string | null;
  end_date: string | null;
  city: string | null;
  state: string | null;
  venue: string | null;
  organizer: string | null;
  exhibitor_directory_status: ExhibitorDirectoryStatus;
  days_until_event: number | null;
  verification_source_urls: string[];
  verification_confidence: number | null;
  verification_notes: string | null;
  verification_checked_at: string;
};

/** Minimum verification confidence required before enrichment may start. */
export const MIN_EVENT_VERIFICATION_CONFIDENCE = 0.75;

export function currentYear(now = new Date()): number {
  return now.getUTCFullYear();
}

/** Pull a plausible 4-digit event year out of a title, URL or date string. */
export function yearFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const years = Array.from(String(text).matchAll(/\b(20\d{2})\b/g)).map((m) => Number(m[1]));
  if (years.length === 0) return null;
  // Prefer the largest plausible year — pages often mention the previous edition too.
  return Math.max(...years);
}

export type YearMatchInput = {
  eventName: string;
  pageTitle?: string | null;
  officialUrl?: string | null;
  startDate?: string | null;
  claimedYear?: number | null;
  now?: Date;
};

export type YearMatch = {
  year: number | null;
  /** True when the strongest evidence points at an edition that already ended. */
  isPastEdition: boolean;
};

/**
 * Decide which edition the official source is describing. Uses the date first,
 * then the page title, then the URL path, then the event name.
 */
export function resolveEventYear(input: YearMatchInput): YearMatch {
  const now = input.now ?? new Date();
  const year =
    input.claimedYear ??
    yearFromText(input.startDate) ??
    yearFromText(input.pageTitle) ??
    yearFromText(input.officialUrl) ??
    yearFromText(input.eventName);
  if (year === null) return { year: null, isPastEdition: false };
  return { year, isPastEdition: year < currentYear(now) };
}

export type VerificationSignals = {
  /** Official source explicitly says the event is canceled. */
  canceled?: boolean;
  /** Official page confirms the event identity (name matched). */
  nameMatched?: boolean;
  /** Resolved edition year from the official source. */
  resolvedYear?: number | null;
  /** Days until the event starts; negative when it has already happened. */
  daysUntilEvent?: number | null;
  /** Two official sources disagree about dates/edition. */
  conflicting?: boolean;
  /** How strongly the source supports the record (0-1). */
  confidence?: number | null;
  now?: Date;
};

/** Map raw verification signals onto the four spec statuses. */
export function classifyVerification(signals: VerificationSignals): EventVerifiedStatus {
  if (signals.canceled) return "CANCELED";
  if (signals.conflicting) return "UNVERIFIED";
  if (!signals.nameMatched) return "UNVERIFIED";

  const days = signals.daysUntilEvent;
  if (typeof days === "number" && days < 0) return "STALE";

  const year = signals.resolvedYear ?? null;
  if (year !== null && year < currentYear(signals.now ?? new Date())) return "STALE";

  const confidence = signals.confidence ?? 0;
  if (confidence < MIN_EVENT_VERIFICATION_CONFIDENCE) return "UNVERIFIED";
  return "CONFIRMED";
}

export type ExclusionInput = {
  status: EventVerifiedStatus;
  daysUntilEvent: number | null;
  hasIdentity: boolean;
  consumerOnly?: boolean;
  geographicallyServiceable?: boolean;
  allowUnverified?: boolean;
  allowHistorical?: boolean;
};

/** Returns a reason string when the event must not enter exhibitor extraction. */
export function exclusionReason(input: ExclusionInput): string | null {
  if (input.status === "CANCELED") return "EVENT_CANCELED";
  if (input.status === "STALE" && !input.allowHistorical) return "EVENT_STALE_OR_ENDED";
  if (!input.allowHistorical && typeof input.daysUntilEvent === "number" && input.daysUntilEvent < 0) {
    return "EVENT_ALREADY_ENDED";
  }
  if (!input.hasIdentity) return "INSUFFICIENT_EVENT_IDENTITY";
  if (input.consumerOnly) return "CONSUMER_EVENT_NO_EXHIBITION";
  if (input.geographicallyServiceable === false) return "OUTSIDE_SERVICE_AREA";
  if (input.status === "UNVERIFIED" && !input.allowUnverified) return "EVENT_NOT_VERIFIED";
  return null;
}

/**
 * Spec processing order: confirmed 80+, confirmed 65-79, confirmed <65,
 * then unverified (only when explicitly allowed). Stale/canceled never run.
 */
export function processingRank(status: EventVerifiedStatus, score: number): number {
  if (status === "CONFIRMED") {
    if (score >= 80) return 0;
    if (score >= 65) return 1;
    return 2;
  }
  if (status === "UNVERIFIED") return 3;
  return 9;
}

export function compareForProcessing(
  a: { verified_status: EventVerifiedStatus; event_score: number },
  b: { verified_status: EventVerifiedStatus; event_score: number },
): number {
  const rank = processingRank(a.verified_status, a.event_score) - processingRank(b.verified_status, b.event_score);
  if (rank !== 0) return rank;
  return b.event_score - a.event_score;
}
