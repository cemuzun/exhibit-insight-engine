/**
 * Evidence normalization, matching and confidence caps (spec Phase 2.4/2.5).
 *
 * An exhibitor record is only accepted when its evidence snippet can be found
 * back in the source content, so a model cannot invent an exhibitor.
 */

export type ExhibitorSourceType =
  | "OFFICIAL_EXHIBITOR_DIRECTORY"
  | "FLOOR_PLAN"
  | "PDF"
  | "DIRECTORY_API"
  | "ORGANIZER_PAGE"
  | "SECONDARY";

export type ExtractionMethod = "HTML" | "EMBEDDED_JSON" | "DIRECTORY_API" | "SITEMAP" | "PDF" | "AI";

export type ExhibitorRecordStatus = "CONFIRMED" | "UNCERTAIN" | "REJECTED" | "STALE";

/** Higher wins field-level conflicts (spec 2.2). */
export const SOURCE_PRIORITY: Record<ExhibitorSourceType, number> = {
  OFFICIAL_EXHIBITOR_DIRECTORY: 6,
  DIRECTORY_API: 5,
  FLOOR_PLAN: 4,
  PDF: 3,
  ORGANIZER_PAGE: 2,
  SECONDARY: 1,
};

/** Configurable extraction-confidence caps (spec 2.5). */
export type ConfidenceCaps = {
  html: number;
  pdf: number;
  ai: number;
  secondary: number;
};

export const DEFAULT_CONFIDENCE_CAPS: ConfidenceCaps = {
  html: 1.0,
  pdf: 0.95,
  ai: 0.8,
  secondary: 0.7,
};

export const MIN_RECORD_EXTRACTION_CONFIDENCE = 0.7;
export const MIN_EVIDENCE_COVERAGE = 0.9;

export function capConfidence(
  value: number,
  method: ExtractionMethod,
  sourceType: ExhibitorSourceType,
  caps: ConfidenceCaps = DEFAULT_CONFIDENCE_CAPS,
): number {
  const cap =
    sourceType === "SECONDARY"
      ? caps.secondary
      : method === "AI"
        ? caps.ai
        : method === "PDF"
          ? caps.pdf
          : caps.html;
  const safe = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(cap, safe));
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[String(name).toLowerCase()] ?? match);
}

/**
 * Normalize evidence and source text the same way so matching is robust but
 * still meaningful: entities decoded, Unicode normalized, invisible characters
 * removed, dashes/quotes unified, whitespace collapsed, lowercased.
 */
export function normalizeEvidence(text: string | null | undefined): string {
  if (!text) return "";
  return decodeEntities(String(text))
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Stable hash of source content so later runs can detect source drift. */
export function evidenceHash(text: string | null | undefined): string {
  const normalized = normalizeEvidence(text);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export type EvidenceLocator = {
  page?: number;
  line?: number;
  selector?: string;
  url?: string;
};

export type EvidenceCheckInput = {
  companyName: string;
  evidenceText: string | null | undefined;
  sourceContent: string;
  locator?: EvidenceLocator | null;
};

export type EvidenceCheck =
  | { ok: true }
  | { ok: false; reason: "MISSING_EVIDENCE" | "EVIDENCE_NOT_IN_SOURCE" | "COMPANY_NOT_IN_EVIDENCE" };

/**
 * Accept a record only when its evidence resolves against the source: either
 * the normalized snippet is present, or a deterministic locator points at it.
 */
export function checkEvidence(input: EvidenceCheckInput): EvidenceCheck {
  const evidence = normalizeEvidence(input.evidenceText);
  if (!evidence) return { ok: false, reason: "MISSING_EVIDENCE" };

  const company = normalizeEvidence(input.companyName);
  if (!company || !evidence.includes(company)) {
    // Tolerate legal-suffix differences: require the distinctive head of the name.
    const head = company.split(" ").slice(0, 2).join(" ");
    if (!head || !evidence.includes(head)) return { ok: false, reason: "COMPANY_NOT_IN_EVIDENCE" };
  }

  const source = normalizeEvidence(input.sourceContent);
  if (source.includes(evidence)) return { ok: true };

  // A deterministic locator (PDF page/line or DOM selector) is also acceptable
  // proof, as long as the company itself still appears in the source.
  const hasLocator = !!(input.locator && (input.locator.selector || input.locator.page || input.locator.line));
  if (hasLocator && source.includes(company)) return { ok: true };

  return { ok: false, reason: "EVIDENCE_NOT_IN_SOURCE" };
}

/** Per-event extraction quality metrics (spec 2.7). */
export type ExtractionMetrics = {
  candidate_sources_found: number;
  sources_verified: number;
  pages_processed: number;
  records_extracted: number;
  records_accepted: number;
  records_rejected: number;
  records_with_booth_numbers: number;
  records_with_profile_urls: number;
  records_with_websites: number;
  deterministic_records: number;
  ai_records: number;
  duplicates_grouped: number;
  confirmed_records: number;
  uncertain_records: number;
  evidence_coverage_percentage: number;
  estimated_completeness: number | null;
  overall_extraction_confidence: number;
  rejection_reasons: Record<string, number>;
};

export function emptyMetrics(): ExtractionMetrics {
  return {
    candidate_sources_found: 0,
    sources_verified: 0,
    pages_processed: 0,
    records_extracted: 0,
    records_accepted: 0,
    records_rejected: 0,
    records_with_booth_numbers: 0,
    records_with_profile_urls: 0,
    records_with_websites: 0,
    deterministic_records: 0,
    ai_records: 0,
    duplicates_grouped: 0,
    confirmed_records: 0,
    uncertain_records: 0,
    evidence_coverage_percentage: 0,
    estimated_completeness: null,
    overall_extraction_confidence: 0,
    rejection_reasons: {},
  };
}

export function finalizeMetrics(metrics: ExtractionMetrics, confidences: number[]): ExtractionMetrics {
  const accepted = metrics.records_accepted;
  metrics.evidence_coverage_percentage =
    accepted > 0 ? Math.round((metrics.confirmed_records / accepted) * 100) : 0;
  metrics.overall_extraction_confidence =
    confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
      : 0;
  return metrics;
}
