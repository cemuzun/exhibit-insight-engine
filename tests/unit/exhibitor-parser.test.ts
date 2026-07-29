import { describe, expect, it } from "vitest";
import {
  cleanCompanyName,
  isLikelyCompanyName,
  parseExhibitorsFromMarkdown,
  parseExhibitorsFromPlainList,
} from "@/lib/exhibitor-parser";

const REGISTER_CHROME =
  "[REGISTER AS A VISITOR](https://www.gastechevent.com/visit/visitor-registration/)";

describe("page chrome is never a company", () => {
  it("rejects the registration link, footer policies, account chrome and dates", () => {
    for (const value of [
      REGISTER_CHROME,
      "REGISTER AS A VISITOR",
      "Age Policy",
      "Log In / Create Account",
      "OCTOBER 12-15, 2026",
    ]) {
      expect(isLikelyCompanyName(value)).toBe(false);
    }
  });

  it("strips markdown links down to the label", () => {
    expect(cleanCompanyName("[Acme Widgets Inc](https://acme.com)")).toBe("Acme Widgets Inc");
    expect(cleanCompanyName(REGISTER_CHROME)).toBe("REGISTER AS A VISITOR");
  });

  it("keeps chrome out of plain-list and markdown extraction", () => {
    const markdown = [
      "## Exhibitors",
      `- ${REGISTER_CHROME}`,
      "- Age Policy",
      "- Acme Widgets Inc",
    ].join("\n");

    for (const rows of [
      parseExhibitorsFromPlainList(markdown, 50),
      parseExhibitorsFromMarkdown(markdown, "https://www.gastechevent.com/exhibitors", 50),
    ]) {
      const names = rows.map((r) => r.company_name);
      expect(names).toContain("Acme Widgets Inc");
      expect(names).not.toContain("REGISTER AS A VISITOR");
      expect(names).not.toContain("Age Policy");
      for (const name of names) expect(name).not.toMatch(/[[\]()]|https?:/);
    }
  });

  it("emits a markup-free normalized_company_name dedupe key", () => {
    const rows = parseExhibitorsFromPlainList("- [Acme Widgets Inc](https://acme.com)", 10);
    expect(rows[0].company_name).toBe("Acme Widgets Inc");
    expect(rows[0].normalized_company_name).toBe("acmewidgets");
  });
});


describe("parseExhibitorsFromMarkdown", () => {
  it("extracts a MapYourShow exhibitor detail page without AI", () => {
    const markdown = `
### International Manufacturing Technology Show 2026

Map Your Show

![Hexagon logo](https://directory.imts.com/mys_shared/IMTS26/logos/00001294.jpg)

# Hexagon

Add to Planner

## Company Information

123 Trade Show Drive

- [hexagon.com](https://hexagon.com "Visit Hexagon on the web")
- [Connect With Hexagon on LinkedIn](https://www.linkedin.com/company/hexagon)
`;

    const exhibitors = parseExhibitorsFromMarkdown(
      markdown,
      "https://directory.imts.com/8_0/exhibitor/exhibitor-details.cfm?exhid=00001294",
      10,
    );

    expect(exhibitors).toHaveLength(1);
    expect(exhibitors[0]).toMatchObject({
      company_name: "Hexagon",
      company_website: "https://hexagon.com",
    });
  });

  it("extracts relative exhibitor detail links from listing pages", () => {
    const markdown = `
## Exhibitors

- [SCHUNK](/8_0/exhibitor/exhibitor-details.cfm?exhid=00003668)
- [Hennig, Inc.](/8_0/exhibitor/exhibitor-details.cfm?exhid=00001033)
- ![Decorative logo](https://example.com/logo.png)
`;

    const exhibitors = parseExhibitorsFromMarkdown(
      markdown,
      "https://directory.imts.com/8_0/explore/exhibitor-alphalist.cfm",
      10,
    );

    expect(exhibitors.map((item) => item.company_name)).toEqual(["SCHUNK", "Hennig, Inc."]);
  });
});
describe("plain list (PDF) exhibitor extraction", () => {
  const pdfMarkdown = [
    "as of July 1, 2026",
    "",
    "# Exhibitors",
    "",
    "The Acheson Group",
    "Admeo, Inc.",
    "American Green Spring Diagnostics",
    "Inc.",
    "Weber Scientific",
    "Xcluder Rodent & Pest Defense",
  ].join("\n");

  it("extracts company names and rejoins wrapped lines", () => {
    const rows = parseExhibitorsFromPlainList(pdfMarkdown, 100);
    const names = rows.map((r) => r.company_name);
    expect(names).toContain("The Acheson Group");
    expect(names).toContain("American Green Spring Diagnostics Inc.");
    expect(names).not.toContain("Exhibitors");
    expect(names).not.toContain("as of July 1, 2026");
  });

  it("falls back to plain list parsing from markdown", () => {
    const rows = parseExhibitorsFromMarkdown(pdfMarkdown, "https://x.org/list.pdf", 100);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});
