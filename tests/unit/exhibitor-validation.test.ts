import { describe, expect, it } from "vitest";
import { validateExhibitorRow, looksLikeBoothNumber, hasCompanyNameStructure } from "@/lib/exhibitor-validation";
import { cleanCompanyName } from "@/lib/exhibitor-parser";


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

describe("account chrome and dates", () => {
  it("rejects login/date/nav strings", () => {
    for (const name of [
      "Log In / Create Account",
      "OCTOBER 12-15, 2026",
      "Login to email Doug Wood",
      "↑ Back to Top",
      "Add to Planner",
      "© 2026 Show Org",
    ]) {
      expect(
        validateExhibitorRow({
          companyName: name,
          sourceUrl: "https://show.com/exhibitors",
          sourceMarkdown: exhibitorPage,
        }).verdict,
      ).toBe("reject");
    }
  });

  it("still accepts real companies", () => {
    expect(hasCompanyNameStructure("Hennig, Inc.")).toBe(true);
    expect(hasCompanyNameStructure("Hexagon")).toBe(true);
  });

  it("rejects a registration link extracted as a company", () => {
    const raw = "[REGISTER AS A VISITOR](https://www.gastechevent.com/visit/visitor-registration/)";
    expect(hasCompanyNameStructure(raw)).toBe(false);
    const r = validateExhibitorRow({
      companyName: raw,
      sourceUrl: "https://www.gastechevent.com/exhibitors",
      sourceMarkdown: exhibitorPage,
    });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("NAME_NOT_COMPANY_SHAPED");
  });

  it("accepts a markdown-wrapped company under a clean, markup-free name", () => {
    const cleaned = cleanCompanyName("[Acme Displays Inc.](https://acme.com/exhibitors/acme)");
    expect(cleaned).toBe("Acme Displays Inc.");
    expect(cleaned).not.toMatch(/[[\]()]|https?:/);
    const r = validateExhibitorRow({
      companyName: cleaned,
      boothNumber: "1042",
      sourceUrl: "https://show.com/exhibitor-list",
      sourceMarkdown: exhibitorPage,
    });
    expect(r.verdict).toBe("accept");
  });
});


describe("CTA / navigation chrome at the validation gate", () => {
  const GASTECH_CTA =
    "[REGISTER AS A VISITOR](https://www.gastechevent.com/visit/visitor-registration/)";

  it("rejects the exact reported record", () => {
    expect(hasCompanyNameStructure(GASTECH_CTA)).toBe(false);
    const r = validateExhibitorRow({
      companyName: GASTECH_CTA,
      boothNumber: "1042",
      profileUrl: "https://www.gastechevent.com/visit/visitor-registration/",
      sourceUrl: "https://www.gastechevent.com/exhibitor-list/",
      sourceMarkdown: exhibitorPage,
    });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("NAME_NOT_COMPANY_SHAPED");
  });

  it("rejects the whole CTA family", () => {
    for (const name of [
      "REGISTER AS A VISITOR",
      "Register To Attend",
      "Visitor Registration",
      "Attendee Registration",
      "Become An Exhibitor",
      "Book A Stand",
      "Request A Booth",
      "Get Your Badge",
      "Buy Tickets",
    ]) {
      expect(
        validateExhibitorRow({
          companyName: name,
          sourceUrl: "https://show.com/exhibitors",
          sourceMarkdown: exhibitorPage,
        }).verdict,
      ).toBe("reject");
    }
  });

  it("accepts a real company whose name contains directory words", () => {
    const r = validateExhibitorRow({
      companyName: "Gastech Exhibitor Technologies Ltd.",
      boothNumber: "1042",
      companyWebsite: "https://gastechexhibitor.com",
      sourceUrl: "https://www.gastechevent.com/exhibitor-list/",
      sourceMarkdown: "## Exhibitor List\n| Gastech Exhibitor Technologies Ltd. | 1042 |",
    });
    expect(r.verdict).toBe("accept");
    expect(r.boothNumber).toBe("1042");
  });
});
