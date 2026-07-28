/**
 * Event verification pass (spec Phase 1.1): confirm a directory-discovered
 * event against its official website before any exhibitor work starts.
 */

import { z } from "zod";
import { firecrawlScrape } from "./firecrawl.server";
import {
  classifyVerification,
  resolveEventYear,
  type EventVerification,
  type ExhibitorDirectoryStatus,
} from "./verification";

export const VerificationSchema = z.object({
  name_matches: z.coerce.boolean().catch(false).default(false),
  event_year: z.coerce.number().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  venue: z.string().nullable().optional(),
  organizer: z.string().nullable().optional(),
  canceled: z.coerce.boolean().catch(false).default(false),
  recurring_annual: z.coerce.boolean().nullable().optional(),
  consumer_only: z.coerce.boolean().nullable().optional(),
  exhibitor_directory_status: z.string().nullable().optional(),
  estimated_exhibitor_count: z.coerce.number().nullable().optional(),
  confidence: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type VerificationExtras = {
  recurring: boolean | null;
  consumerOnly: boolean | null;
  estimatedExhibitorCount: number | null;
};

const DIRECTORY_STATUSES: ExhibitorDirectoryStatus[] = ["PUBLIC", "GATED", "PDF_ONLY", "NONE", "UNKNOWN"];

function coerceDirectoryStatus(value: string | null | undefined): ExhibitorDirectoryStatus {
  const upper = String(value ?? "").toUpperCase().replace(/[^A-Z_]/g, "");
  return (DIRECTORY_STATUSES as string[]).includes(upper) ? (upper as ExhibitorDirectoryStatus) : "UNKNOWN";
}

function daysUntil(dateText: string | null | undefined, now: Date): number | null {
  if (!dateText) return null;
  const parsed = Date.parse(String(dateText));
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 86_400_000);
}

/** Directory-only fallback used when the official page cannot be reached. */
export function unverifiedResult(args: {
  officialUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  state: string | null;
  venue: string | null;
  notes: string;
  now?: Date;
}): EventVerification {
  const now = args.now ?? new Date();
  return {
    verified_status: "UNVERIFIED",
    event_year: null,
    official_event_url: args.officialUrl,
    start_date: args.startDate,
    end_date: args.endDate,
    city: args.city,
    state: args.state,
    venue: args.venue,
    organizer: null,
    exhibitor_directory_status: "UNKNOWN",
    days_until_event: daysUntil(args.startDate, now),
    verification_source_urls: args.officialUrl ? [args.officialUrl] : [],
    verification_confidence: null,
    verification_notes: args.notes,
    verification_checked_at: now.toISOString(),
  };
}

export type VerifyEventInput = {
  eventName: string;
  officialUrl: string | null;
  directoryStartDate: string | null;
  directoryEndDate: string | null;
  city: string | null;
  state: string | null;
  venue: string | null;
  now?: Date;
  /** Structured-output caller supplied by the pipeline (keeps AI wiring in one place). */
  generate: <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, prompt: string) => Promise<T>;
};

/**
 * Scrape the official site and let the model read the identity fields off the
 * page. All status decisions are made by pure logic in `verification.ts`.
 */
export async function verifyEvent(
  input: VerifyEventInput,
): Promise<{ verification: EventVerification; extras: VerificationExtras }> {
  const now = input.now ?? new Date();
  const emptyExtras: VerificationExtras = {
    recurring: null,
    consumerOnly: null,
    estimatedExhibitorCount: null,
  };

  if (!input.officialUrl) {
    return {
      verification: unverifiedResult({
        officialUrl: null,
        startDate: input.directoryStartDate,
        endDate: input.directoryEndDate,
        city: input.city,
        state: input.state,
        venue: input.venue,
        notes: "No official event URL in the directory listing — could not verify the current edition.",
        now,
      }),
      extras: emptyExtras,
    };
  }

  let markdown = "";
  let title: string | null = null;
  try {
    const page = await firecrawlScrape(input.officialUrl, {
      formats: ["markdown", "links"],
      waitFor: 2500,
      cache: { maxAgeMs: 24 * 60 * 60 * 1000 },
    });
    markdown = page.markdown ?? "";
    title = page.metadata?.title ?? null;
  } catch (e) {
    return {
      verification: unverifiedResult({
        officialUrl: input.officialUrl,
        startDate: input.directoryStartDate,
        endDate: input.directoryEndDate,
        city: input.city,
        state: input.state,
        venue: input.venue,
        notes: `Official site could not be fetched: ${(e as Error).message}`,
        now,
      }),
      extras: emptyExtras,
    };
  }

  if (!markdown.trim()) {
    return {
      verification: unverifiedResult({
        officialUrl: input.officialUrl,
        startDate: input.directoryStartDate,
        endDate: input.directoryEndDate,
        city: input.city,
        state: input.state,
        venue: input.venue,
        notes: "Official site returned no readable content.",
        now,
      }),
      extras: emptyExtras,
    };
  }

  let parsed: z.infer<typeof VerificationSchema> | null = null;
  try {
    parsed = await input.generate(
      VerificationSchema,
      `You are verifying a trade show against its OFFICIAL website. Use only what the page states.

Directory listing says:
- Event name: ${input.eventName}
- Dates: ${input.directoryStartDate ?? "unknown"} — ${input.directoryEndDate ?? "unknown"}
- Location: ${[input.city, input.state].filter(Boolean).join(", ") || "unknown"}
- Venue: ${input.venue ?? "unknown"}

Page title: ${title ?? "unknown"}
Page URL: ${input.officialUrl}

Answer strictly from the page content:
- name_matches: does this page describe the same event?
- event_year: which edition YEAR does this page describe (the upcoming one if several are mentioned)?
- start_date / end_date: ISO dates (YYYY-MM-DD) when stated, else null.
- city / state / venue / organizer when stated, else null.
- canceled: true only if the page says the event is canceled.
- recurring_annual: true if the page indicates an annual/recurring event.
- consumer_only: true if it is a consumer festival with no commercial exhibition component.
- exhibitor_directory_status: PUBLIC (browsable exhibitor list), GATED (login required), PDF_ONLY, NONE, or UNKNOWN.
- estimated_exhibitor_count when stated, else null.
- confidence: 0-1, how well the page supports this verification.
- notes: one short sentence of justification.

--- OFFICIAL PAGE MARKDOWN ---
${markdown.slice(0, 30000)}`,
    );
  } catch (e) {
    return {
      verification: unverifiedResult({
        officialUrl: input.officialUrl,
        startDate: input.directoryStartDate,
        endDate: input.directoryEndDate,
        city: input.city,
        state: input.state,
        venue: input.venue,
        notes: `Verification model call failed: ${(e as Error).message}`,
        now,
      }),
      extras: emptyExtras,
    };
  }

  const resolved = resolveEventYear({
    eventName: input.eventName,
    pageTitle: title,
    officialUrl: input.officialUrl,
    startDate: parsed.start_date ?? input.directoryStartDate,
    claimedYear: parsed.event_year ?? null,
    now,
  });

  const startDate = parsed.start_date ?? input.directoryStartDate;
  const days = daysUntil(startDate, now);
  const confidence =
    parsed.confidence === null || parsed.confidence === undefined
      ? null
      : Math.max(0, Math.min(1, Number(parsed.confidence)));

  const status = classifyVerification({
    canceled: parsed.canceled,
    nameMatched: parsed.name_matches,
    resolvedYear: resolved.year,
    daysUntilEvent: days,
    confidence: confidence ?? 0,
    now,
  });

  return {
    verification: {
      verified_status: status,
      event_year: resolved.year,
      official_event_url: input.officialUrl,
      start_date: startDate,
      end_date: parsed.end_date ?? input.directoryEndDate,
      city: parsed.city ?? input.city,
      state: parsed.state ?? input.state,
      venue: parsed.venue ?? input.venue,
      organizer: parsed.organizer ?? null,
      exhibitor_directory_status: coerceDirectoryStatus(parsed.exhibitor_directory_status),
      days_until_event: days,
      verification_source_urls: [input.officialUrl],
      verification_confidence: confidence,
      verification_notes: parsed.notes ?? null,
      verification_checked_at: now.toISOString(),
    },
    extras: {
      recurring: parsed.recurring_annual ?? null,
      consumerOnly: parsed.consumer_only ?? null,
      estimatedExhibitorCount: parsed.estimated_exhibitor_count ?? null,
    },
  };
}
