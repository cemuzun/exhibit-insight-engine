/**
 * Exhibitor-instance identity and account grouping (spec Phase 2.6).
 *
 * The instance key preserves distinct exhibition presences (multiple booths,
 * sibling brands, regional units); the account key groups them for CRM work
 * without destroying the instance detail.
 */

import { normalizedCompanyKey } from "./exhibitor-parser";

export type ExhibitorInstanceInput = {
  eventId: string;
  companyName: string;
  normalizedCompanyName?: string | null;
  profileUrl?: string | null;
  boothNumber?: string | null;
  representedBrand?: string | null;
  companyWebsite?: string | null;
};

function slug(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`.toLowerCase();
  } catch {
    return slug(url);
  }
}

/** Stable identity for ONE exhibiting presence at ONE event. */
export function exhibitorInstanceKey(input: ExhibitorInstanceInput): string {
  const name = input.normalizedCompanyName
    ? normalizedCompanyKey(input.normalizedCompanyName)
    : normalizedCompanyKey(input.companyName);
  const parts = [
    input.eventId,
    canonicalUrl(input.profileUrl),
    slug(input.boothNumber),
    name,
    normalizedCompanyKey(input.representedBrand ?? ""),
  ];
  return parts.join("|");
}

/** Grouping key for CRM enrichment: domain when known, otherwise the name. */
export function accountKey(input: { companyWebsite?: string | null; companyName: string }): string {
  if (input.companyWebsite) {
    try {
      return new URL(input.companyWebsite).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      // fall through to name
    }
  }
  return normalizedCompanyKey(input.companyName);
}

/**
 * Dedupe by instance key only. Returns the kept rows plus how many duplicates
 * were folded into an existing instance.
 */
export function dedupeExhibitorInstances<T extends { exhibitor_instance_key: string }>(
  rows: T[],
): { kept: T[]; duplicatesGrouped: number } {
  const kept = new Map<string, T>();
  let duplicatesGrouped = 0;
  for (const row of rows) {
    if (kept.has(row.exhibitor_instance_key)) {
      duplicatesGrouped += 1;
      continue;
    }
    kept.set(row.exhibitor_instance_key, row);
  }
  return { kept: Array.from(kept.values()), duplicatesGrouped };
}
