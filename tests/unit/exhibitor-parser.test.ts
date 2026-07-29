import { describe, expect, it } from "vitest";
import {
  cleanCompanyName,
  isLikelyCompanyName,
  parseExhibitorsFromMarkdown,
  parseExhibitorsFromPlainList,
  isCtaOrNavLabel,
  isNavigationHref,
  isNavigationLinkLine,
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

const GASTECH_CTA_URL = "https://www.gastechevent.com/visit/visitor-registration/";
const GASTECH_CTA = `[REGISTER AS A VISITOR](${GASTECH_CTA_URL})`;

describe("CTA and navigation links are never exhibitors", () => {
  it("rejects the exact reported record by label and by href", () => {
    expect(isLikelyCompanyName(GASTECH_CTA)).toBe(false);
    expect(isCtaOrNavLabel(GASTECH_CTA)).toBe(true);
    expect(isNavigationHref(GASTECH_CTA_URL)).toBe(true);
    expect(isNavigationLinkLine(`- ${GASTECH_CTA}`)).toBe(true);
  });

  it("rejects the CTA label family", () => {
    for (const label of [
      "REGISTER AS A VISITOR",
      "Register to Attend",
      "Visitor Registration",
      "Attendee Registration",
      "Become an Exhibitor",
      "Book a Stand",
      "Request a Booth",
      "Get Your Badge",
      "Buy Tickets",
      "Plan Your Visit",
      "Why Exhibit",
    ]) {
      expect(isCtaOrNavLabel(label)).toBe(true);
      expect(isLikelyCompanyName(label)).toBe(false);
    }
  });

  it("treats navigation hrefs as non-directory links", () => {
    for (const href of [
      "https://show.com/visit/visitor-registration/",
      "https://show.com/register",
      "/attendee/tickets",
      "https://show.com/login?next=/exhibitors",
      "https://show.com/book-a-stand/",
    ]) {
      expect(isNavigationHref(href)).toBe(true);
    }
  });

  it("does not reject legitimate exhibitor links or company websites", () => {
    expect(isNavigationHref("https://gastechexhibitor.com")).toBe(false);
    expect(isNavigationHref("https://show.com/exhibitors/gastech-exhibitor-technologies")).toBe(false);
    expect(isCtaOrNavLabel("Gastech Exhibitor Technologies Ltd.")).toBe(false);
    expect(isLikelyCompanyName("Gastech Exhibitor Technologies Ltd.")).toBe(true);
    expect(isLikelyCompanyName("Register Machinery Corp")).toBe(true);
  });

  it("never returns the CTA from parseExhibitorsFromMarkdown", () => {
    const markdown = [
      "# Gastech Exhibition",
      `[REGISTER AS A VISITOR](${GASTECH_CTA_URL})`,
      "[Book a Stand](https://www.gastechevent.com/exhibit/book-a-stand/)",
      "## Exhibitor List",
      "- Gastech Exhibitor Technologies Ltd. — Booth 1042",
      "- Northwind Systems LLC — Booth B204",
    ].join("\n");

    const rows = parseExhibitorsFromMarkdown(markdown, "https://www.gastechevent.com/exhibitor-list/", 50);
    const names = rows.map((r) => r.company_name);
    expect(names).toContain("Gastech Exhibitor Technologies Ltd.");
    expect(names).toContain("Northwind Systems LLC");
    expect(names.join("|")).not.toMatch(/register|book a stand|gastechevent\.com/i);
  });

  it("does not mine a navigation-heavy HTML page for companies", () => {
    const navPage = [
      "# Gastech Exhibition & Conference",
      `[REGISTER AS A VISITOR](${GASTECH_CTA_URL})`,
      "[Plan Your Visit](https://www.gastechevent.com/visit/)",
      "[Conference Programme](https://www.gastechevent.com/conference/)",
      "Age Policy",
    ].join("\n");

    expect(parseExhibitorsFromMarkdown(navPage, "https://www.gastechevent.com/", 50)).toHaveLength(0);
  });

  it("still allows the plain-list fallback for PDF exhibitor handouts", () => {
    const pdf = ["Acme Displays Inc.", "Northwind Systems LLC", "Hennig, Inc."].join("\n");
    const rows = parseExhibitorsFromMarkdown(pdf, "https://show.com/files/handout.pdf", 50);
    expect(rows.map((r) => r.company_name)).toEqual([
      "Acme Displays Inc.",
      "Northwind Systems LLC",
      "Hennig, Inc.",
    ]);
  });
});
