import { describe, expect, it } from "vitest";
import { parseExhibitorsFromMarkdown } from "@/lib/exhibitor-parser";

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
