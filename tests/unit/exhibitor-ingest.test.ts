import { describe, expect, it } from "vitest";
import { normalizeCandidateName } from "@/lib/exhibitor-parser";

/**
 * The pipeline validates and stores whatever `normalizeCandidateName` returns,
 * so this is the single point that decides which names reach the database.
 */
describe("normalizeCandidateName", () => {
  it("rejects page chrome extracted as a markdown link", () => {
    expect(
      normalizeCandidateName(
        "[REGISTER AS A VISITOR](https://www.gastechevent.com/visit/visitor-registration/)",
      ),
    ).toBeNull();
  });

  it("unwraps a markdown-wrapped legitimate company", () => {
    const result = normalizeCandidateName("[ACME BOOTH SYSTEMS INC](https://www.acme.com/exhibitors/acme)");
    expect(result).not.toBeNull();
    expect(result!.company).toBe("ACME BOOTH SYSTEMS INC");
    expect(result!.company).not.toMatch(/[[\]()]|https?:/);
    expect(result!.key).toBe("acmeboothsystems");
  });

  it("rejects empty and non-company values", () => {
    expect(normalizeCandidateName("")).toBeNull();
    expect(normalizeCandidateName(null)).toBeNull();
    expect(normalizeCandidateName("Age Policy")).toBeNull();
    expect(normalizeCandidateName("  ")).toBeNull();
  });

  it("keeps only real companies from a mixed extraction batch", () => {
    const batch = [
      "[REGISTER AS A VISITOR](https://www.gastechevent.com/visit/visitor-registration/)",
      "[Acme Widgets Inc](https://acme.com)",
      "Hennig, Inc.",
      "Log In / Create Account",
    ];
    const kept = batch.map(normalizeCandidateName).filter((r) => r !== null);

    expect(kept).toHaveLength(2);
    expect(kept.map((r) => r!.company)).toEqual(["Acme Widgets Inc", "Hennig, Inc."]);
    for (const row of kept) {
      expect(row!.key).toMatch(/^[a-z0-9]+$/);
    }
  });
});
