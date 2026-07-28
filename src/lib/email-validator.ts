/**
 * Outbound email validator (spec Phase 3.5/3.6).
 */

export type EmailValidationError = {
  code:
    | "WORD_COUNT"
    | "MISSING_EVENT_NAME"
    | "MISSING_COMPANY_NAME"
    | "MISSING_PERSONALIZATION"
    | "MISSING_SERVICE"
    | "MISSING_CTA"
    | "BANNED_PHRASE"
    | "UNSUPPORTED_BOOTH_CLAIM"
    | "UNSUPPORTED_VENDOR_CLAIM"
    | "UNSUPPORTED_BUDGET_CLAIM"
    | "FABRICATED_RECIPIENT"
    | "SUBJECT_FORMAT";
  message: string;
};

export type EmailValidationResult = {
  valid: boolean;
  word_count: number;
  errors: EmailValidationError[];
};

export const BANNED_PHRASES = [
  "industry leader",
  "impressed by your growth",
  "love what your company is doing",
  "improve your roi",
  "increase engagement",
  "take your booth to the next level",
  "world-class",
  "game-changer",
];

const CTA_RE =
  /\?\s*$|would it be useful|would you like|open to|happy to (send|share|prepare)|shall i|can i send|worth a (quick )?look/im;

const BOOTH_CLAIM_RE =
  /(your|their) (previous |last |current )?(booth|exhibit|stand)\b|we (saw|reviewed|inspected) your (booth|exhibit)/i;

const VENDOR_CLAIM_RE = /(your current|existing) (vendor|supplier|fabricator)|we (already )?work with your/i;

const BUDGET_CLAIM_RE = /your budget (is|of)\s*\$?\d|you (spend|spent)\s*\$\d/i;

export function wordCount(text: string): number {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export type EmailValidationInput = {
  subject: string;
  body: string;
  companyName: string;
  eventName: string;
  personalizationFactValue: string | null;
  serviceOffered: string | null;
  recipientName: string | null;
  /** True when a verified booth fact backs booth references. */
  hasBoothEvidence?: boolean;
  /** True when the recipient is a real, verified person. */
  recipientVerified?: boolean;
  minWords?: number;
  maxWords?: number;
};

export function validateEmail(input: EmailValidationInput): EmailValidationResult {
  const errors: EmailValidationError[] = [];
  const body = String(input.body ?? "");
  const lower = body.toLowerCase();
  const count = wordCount(body);
  const min = input.minWords ?? 60;
  const max = input.maxWords ?? 120;

  if (count < min || count > max) {
    errors.push({ code: "WORD_COUNT", message: `Body is ${count} words; required ${min}-${max}.` });
  }
  if (input.eventName && !lower.includes(input.eventName.toLowerCase())) {
    errors.push({ code: "MISSING_EVENT_NAME", message: "Email does not name the trade show." });
  }
  if (input.companyName && !lower.includes(input.companyName.toLowerCase())) {
    errors.push({ code: "MISSING_COMPANY_NAME", message: "Email does not name the company." });
  }
  if (!input.personalizationFactValue?.trim()) {
    errors.push({ code: "MISSING_PERSONALIZATION", message: "No verified personalization fact attached." });
  }
  if (!input.serviceOffered?.trim()) {
    errors.push({ code: "MISSING_SERVICE", message: "No specific service offered." });
  } else if (!lower.includes(input.serviceOffered.toLowerCase().split(" ")[0])) {
    errors.push({ code: "MISSING_SERVICE", message: "Offered service is not mentioned in the body." });
  }
  if (!CTA_RE.test(body)) {
    errors.push({ code: "MISSING_CTA", message: "No low-friction call to action found." });
  }
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      errors.push({ code: "BANNED_PHRASE", message: `Contains generic phrase "${phrase}".` });
    }
  }
  if (!input.hasBoothEvidence && BOOTH_CLAIM_RE.test(body)) {
    errors.push({ code: "UNSUPPORTED_BOOTH_CLAIM", message: "References the recipient's booth without evidence." });
  }
  if (VENDOR_CLAIM_RE.test(body)) {
    errors.push({ code: "UNSUPPORTED_VENDOR_CLAIM", message: "Makes an unsupported vendor claim." });
  }
  if (BUDGET_CLAIM_RE.test(body)) {
    errors.push({ code: "UNSUPPORTED_BUDGET_CLAIM", message: "Makes an unsupported budget claim." });
  }
  if (input.recipientName && input.recipientVerified === false) {
    errors.push({ code: "FABRICATED_RECIPIENT", message: "Recipient name is not verified." });
  }

  const expectedSubject = `${input.companyName}`.toLowerCase();
  if (input.subject && !input.subject.toLowerCase().includes(expectedSubject)) {
    errors.push({ code: "SUBJECT_FORMAT", message: "Subject must reference the company." });
  }

  return { valid: errors.length === 0, word_count: count, errors };
}

/** Canonical subject line from the spec. */
export function buildSubject(companyName: string, eventName: string): string {
  return `${companyName}'s exhibit plans for ${eventName}`;
}
