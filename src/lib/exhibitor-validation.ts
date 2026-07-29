/**
 * Pattern validation for extracted exhibitor rows.
 *
 * A row is only accepted when it looks like a real exhibiting company:
 *  - the name has company-name structure (not nav chrome, not a sentence)
 *  - booth/stand fields, profile URLs or websites back it up
 *  - the surrounding page section is exhibitor context, not attendees/speakers
 *
 * Rows that fail hard checks are rejected. Rows that only look weak are
 * downgraded (low confidence -> UNCERTAIN) instead of being saved as
 * confirmed exhibitors.
 */

import { cleanCompanyName, isCtaOrNavLabel, isLikelyCompanyName } from "./exhibitor-parser";

export type ExhibitorValidationVerdict = "accept" | "downgrade" | "reject";

export type ExhibitorValidationResult = {
  verdict: ExhibitorValidationVerdict;
  score: number;
  /** Multiplier applied to the extraction confidence (1 = untouched). */
  confidenceFactor: number;
  signals: string[];
  reason: string;
  /** Booth value after validation — cleared when it does not look like a booth. */
  boothNumber: string | null;
};

const LEGAL_SUFFIX_RE =
  /\b(inc|inc\.|llc|l\.l\.c|ltd|ltd\.|limited|corp|corp\.|corporation|co|co\.|company|gmbh|ag|a\.g|s\.a|sa|srl|s\.r\.l|bv|b\.v|nv|n\.v|plc|pty|kft|oy|ab|as|aps|spa|s\.p\.a|kg|sas|sl|s\.l|llp|lp|group|holdings|industries|technologies|systems|solutions|international|manufacturing|labs|laboratories|enterprises|products|equipment|machinery|supply|works|partners)\b/i;

const BOOTH_RE = /^[A-Za-z]{0,4}[-\s]?\d{1,6}(?:[-.\s/][A-Za-z0-9]{1,6})?$/;

/** Headings that mean the surrounding list is NOT an exhibitor list. */
const NON_EXHIBITOR_SECTION_RE =
  /\b(attendees?|attendee list|registrants?|speakers?|presenters?|panelists?|committees?|board of directors|staff|our team|press|media partners?|advisory|volunteers?|testimonials?|job board|careers?|awards?|schedule|agenda|sessions?)\b/i;

const EXHIBITOR_SECTION_RE =
  /\b(exhibitors?|exhibit(ing|ors)? (list|hall|directory|companies)|booth|stand no|stand number|floor ?plan|showcase|vendors? (hall|list)|expo hall)\b/i;

const SENTENCE_RE = /[.!?]\s+[a-z]/;

function nearestHeadingBefore(markdown: string, index: number): string | null {
  const before = markdown.slice(0, index);
  const matches = Array.from(before.matchAll(/^(#{1,6}|\*\*)\s*(.{2,120}?)\s*(\*\*)?$/gm));
  const last = matches[matches.length - 1];
  return last ? last[2].trim() : null;
}

function locate(markdown: string, name: string): number {
  const idx = markdown.toLowerCase().indexOf(name.toLowerCase());
  return idx;
}

export function looksLikeBoothNumber(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v || v.length > 12) return false;
  return BOOTH_RE.test(v) && /\d/.test(v);
}

export function hasCompanyNameStructure(value: string): boolean {
  const name = cleanCompanyName(value);
  if (!isLikelyCompanyName(name)) return false;
  const words = name.split(/\s+/);
  // Long legal/association names are real ("ABIMAQ - The Brazilian Association
  // of the Machinery & Equipment Industry"), so only very long strings are prose.
  if (words.length > 16) return false;
  // Abbreviated company names are full of periods ("C.R. Onsrud Inc.",
  // "IDEAL-Trade Service, spol. s r.o."), so a period alone is not a sentence —
  // only flag prose that is both long and sentence-shaped.
  if (words.length > 8 && SENTENCE_RE.test(name)) return false;
  if (/\?$/.test(name)) return false;
  if (/^(https?:|www\.)/i.test(name)) return false;
  if (/^\W+$/.test(name)) return false;
  // Sentence fragments / calls to action (leading words only, so company names
  // containing "View" or "See" mid-name survive).
  if (/^(click|please|learn|read|view|see|find out|contact us|visit our)\b/i.test(name)) return false;
  if (/\b(click here|please contact|learn more|read more|find out more|contact us|visit our)\b/i.test(name)) return false;
  return true;
}


export function validateExhibitorRow(input: {
  companyName: string;
  boothNumber?: string | null;
  profileUrl?: string | null;
  companyWebsite?: string | null;
  sourceUrl: string;
  sourceMarkdown: string;
  evidenceText?: string | null;
}): ExhibitorValidationResult {
  const signals: string[] = [];
  const name = cleanCompanyName(input.companyName);

  if (!hasCompanyNameStructure(name)) {
    return {
      verdict: "reject",
      score: 0,
      confidenceFactor: 0,
      signals,
      reason: "NAME_NOT_COMPANY_SHAPED",
      boothNumber: null,
    };
  }

  const markdown = input.sourceMarkdown ?? "";
  const idx = locate(markdown, name);
  const heading = idx >= 0 ? nearestHeadingBefore(markdown, idx) : null;
  const contextWindow = idx >= 0 ? markdown.slice(Math.max(0, idx - 1200), idx + 400) : markdown.slice(0, 2000);

  // Hard reject: the row sits under an attendees/speakers/press style heading.
  if (heading && NON_EXHIBITOR_SECTION_RE.test(heading) && !EXHIBITOR_SECTION_RE.test(heading)) {
    return {
      verdict: "reject",
      score: 0,
      confidenceFactor: 0,
      signals: [`section:${heading}`],
      reason: "NON_EXHIBITOR_SECTION",
      boothNumber: null,
    };
  }

  let score = 0;

  if (LEGAL_SUFFIX_RE.test(name)) {
    score += 2;
    signals.push("legal_suffix");
  }
  if (/^[A-Z0-9]/.test(name) && /[A-Z]/.test(name.slice(1))) {
    score += 1;
    signals.push("title_case");
  }

  const booth = looksLikeBoothNumber(input.boothNumber) ? String(input.boothNumber).trim() : null;
  if (booth) {
    score += 2;
    signals.push("booth_number");
  } else if (input.boothNumber) {
    signals.push("booth_invalid");
  }

  if (input.profileUrl) {
    score += 1;
    signals.push("profile_url");
  }
  if (input.companyWebsite) {
    score += 1;
    signals.push("company_website");
  }

  const exhibitorContext =
    EXHIBITOR_SECTION_RE.test(heading ?? "") ||
    EXHIBITOR_SECTION_RE.test(contextWindow) ||
    EXHIBITOR_SECTION_RE.test(input.sourceUrl) ||
    EXHIBITOR_SECTION_RE.test(input.evidenceText ?? "");
  if (exhibitorContext) {
    score += 2;
    signals.push("exhibitor_context");
  } else {
    signals.push("no_exhibitor_context");
  }

  if (score >= 4) {
    return { verdict: "accept", score, confidenceFactor: 1, signals, reason: "OK", boothNumber: booth };
  }
  if (score >= 2) {
    return {
      verdict: "downgrade",
      score,
      confidenceFactor: 0.7,
      signals,
      reason: "LOW_CONFIDENCE_PATTERN_MATCH",
      boothNumber: booth,
    };
  }
  return {
    verdict: "reject",
    score,
    confidenceFactor: 0,
    signals,
    reason: "WEAK_EXHIBITOR_SIGNALS",
    boothNumber: booth,
  };
}
