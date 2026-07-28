// Server-only HubSpot CRM client (routed through the Lovable connector gateway).
const GATEWAY_URL = "https://connector-gateway.lovable.dev/hubspot";

function headers() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.HUBSPOT_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!connKey) throw new Error("HUBSPOT_API_KEY is not configured — connect HubSpot first");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

async function hs<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    console.error(`HubSpot request failed [${res.status}] ${path}: ${body}`);
    throw new Error(`HubSpot request failed [${res.status}]: ${body}`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

type SearchResult = { total?: number; results?: Array<{ id: string }> };

export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export function isValidEmail(email: string | null | undefined): email is string {
  return !!email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim());
}

export async function findCompanyByDomain(domain: string): Promise<string | null> {
  const data = await hs<SearchResult>("/crm/v3/objects/companies/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }],
      properties: ["domain"],
      limit: 1,
    }),
  });
  return data.results?.[0]?.id ?? null;
}

export async function findContactByEmail(email: string): Promise<string | null> {
  const data = await hs<SearchResult>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }] }],
      properties: ["email"],
      limit: 1,
    }),
  });
  return data.results?.[0]?.id ?? null;
}

export async function createCompany(properties: Record<string, string>): Promise<string> {
  const data = await hs<{ id: string }>("/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  return data.id;
}

export async function createContact(properties: Record<string, string>): Promise<string> {
  const data = await hs<{ id: string }>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  return data.id;
}

export async function associateContactToCompany(contactId: string, companyId: string) {
  await hs(`/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`, {
    method: "PUT",
  });
}
