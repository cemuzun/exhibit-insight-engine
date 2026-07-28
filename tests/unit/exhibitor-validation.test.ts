import { describe, expect, it } from "vitest";
import { validateExhibitorRow, looksLikeBoothNumber, hasCompanyNameStructure } from "@/lib/exhibitor-validation";

const exhibitorPage = `## Exhibitor List 2026

| Company | Booth |
| Acme Displays Inc. | 1042 |
| Northwind Systems LLC | B204 |
`;

const attendeePage = `## Attendees

- Acme Displays Inc.
- Northwind Systems LLC
`;

describe("exhibitor validation", () => {
  it("accepts a well-formed exhibitor row with booth in exhibitor context", () => {
    const r = validateExhibitorRow({
      companyName: "Acme Displays Inc.",
      boothNumber: "1042",
      sourceUrl: "https://show.com/exhibitor-list",
      sourceMarkdown: exhibitorPage,
    });
    expect(r.verdict).toBe("accept");
    expect(r.boothNumber).toBe("1042");
  });

  it("rejects rows sitting under an attendees heading", () => {
    const r = validateExhibitorRow({
      companyName: "Acme Displays Inc.",
      boothNumber: null,
      sourceUrl: "https://show.com/attendees",
      sourceMarkdown: attendeePage,
    });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("NON_EXHIBITOR_SECTION");
  });

  it("rejects navigation labels and sentence fragments", () => {
    for (const name of ["ATTENDEES", "SUPPLIERS", "Click here to learn more about exhibiting"]) {
      const r = validateExhibitorRow({
        companyName: name,
        sourceUrl: "https://show.com/exhibitors",
        sourceMarkdown: exhibitorPage,
      });
      expect(r.verdict).toBe("reject");
    }
  });

  it("downgrades weak rows instead of accepting them", () => {
    const r = validateExhibitorRow({
      companyName: "Blue Widgets",
      sourceUrl: "https://show.com/page",
      sourceMarkdown: "Some generic page listing Blue Widgets and others.",
    });
    expect(r.verdict).not.toBe("accept");
    if (r.verdict === "downgrade") expect(r.confidenceFactor).toBeLessThan(1);
  });

  it("clears booth values that are not booth-shaped", () => {
    const r = validateExhibitorRow({
      companyName: "Northwind Systems LLC",
      boothNumber: "see floor plan for details",
      sourceUrl: "https://show.com/exhibitors",
      sourceMarkdown: exhibitorPage,
    });
    expect(r.boothNumber).toBeNull();
  });

  it("validates booth shapes and name structure", () => {
    expect(looksLikeBoothNumber("B204")).toBe(true);
    expect(looksLikeBoothNumber("Hall")).toBe(false);
    expect(hasCompanyNameStructure("Acme Displays Inc.")).toBe(true);
    expect(hasCompanyNameStructure("Register Now")).toBe(false);
  });
});
