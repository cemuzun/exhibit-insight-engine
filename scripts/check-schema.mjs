#!/usr/bin/env node
// Verify the expected Supabase tables, columns and RPCs exist before the app
// runs. Uses the Data API (PostgREST) with the service role key when present,
// falling back to the publishable key.
//
// Exits 0 when everything matches or when the check is skipped (no
// credentials). Exits 1 with exact migration guidance when something is
// missing.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { REQUIRED_TABLES, REQUIRED_FUNCTIONS } from "./required-schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function loadDotenv() {
  const file = resolve(here, "../.env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotenv();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export async function checkSchema() {
  if (!url || !key) {
    return {
      skipped: true,
      reason:
        "no Supabase credentials in the environment (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY)",
      problems: [],
    };
  }

  const base = url.replace(/\/$/, "");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const problems = [];
  const ok = [];

  for (const table of REQUIRED_TABLES) {
    const query = `${base}/rest/v1/${table.name}?select=${encodeURIComponent(table.columns.join(","))}&limit=0`;
    let res;
    try {
      res = await fetch(query, { headers });
    } catch (error) {
      return {
        skipped: true,
        reason: `could not reach the database (${error instanceof Error ? error.message : String(error)})`,
        problems: [],
      };
    }

    if (res.ok) {
      ok.push(table.name);
      continue;
    }

    let body = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const code = body?.code ?? String(res.status);
    const message = body?.message ?? res.statusText;

    if (code === "42P01" || res.status === 404) {
      problems.push({
        table: table.name,
        kind: "missing table",
        detail: message,
        fix: table.migration,
      });
    } else if (code === "42703") {
      problems.push({
        table: table.name,
        kind: "missing column(s)",
        detail: message,
        fix: `add the missing column to public.${table.name} — expected: ${table.columns.join(", ")}`,
      });
    } else if (code === "42501" || res.status === 401 || res.status === 403) {
      problems.push({
        table: table.name,
        kind: "no Data API access",
        detail: message,
        fix: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table.name} TO authenticated; GRANT ALL ON public.${table.name} TO service_role;`,
      });
    } else {
      problems.push({
        table: table.name,
        kind: `unexpected error (${code})`,
        detail: message,
        fix: table.migration,
      });
    }
  }

  for (const fn of REQUIRED_FUNCTIONS.filter((f) => f.kind === "rpc")) {
    const res = await fetch(`${base}/rest/v1/rpc/${fn.name}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    // 404 = the function does not exist; any other status means it is present
    // (400/500 just means our empty arguments were wrong).
    if (res.status === 404) {
      problems.push({
        table: `${fn.name}()`,
        kind: "missing function",
        detail: "not exposed by the Data API",
        fix: fn.migration,
      });
    } else {
      ok.push(`${fn.name}()`);
    }
  }

  return { skipped: false, problems, ok };
}

export function reportSchema(result) {
  if (result.skipped) {
    console.log(`schema: SKIPPED — ${result.reason}`);
    return true;
  }
  if (result.problems.length === 0) {
    console.log(`schema: OK — ${result.ok.length} required table(s)/function(s) verified`);
    for (const name of result.ok) console.log(`  ✓ ${name}`);
    return true;
  }

  console.error(`\nschema: FAILED — ${result.problems.length} database problem(s)\n`);
  for (const p of result.problems) {
    console.error(`  ✗ ${p.table} — ${p.kind}`);
    console.error(`      ${p.detail}`);
    console.error(`      fix: ${p.fix}`);
  }
  console.error("\nHow to fix:");
  console.error("  Create a migration that adds the missing objects, for example:");
  console.error("    CREATE TABLE public.<table> (...);");
  console.error("    GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;");
  console.error("    GRANT ALL ON public.<table> TO service_role;");
  console.error("    ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;");
  console.error("    CREATE POLICY \"<table> owner access\" ON public.<table>");
  console.error("      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);");
  console.error("  In Lovable, ask the assistant to run the migration — it applies after your approval.");
  return false;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await checkSchema();
  process.exit(reportSchema(result) ? 0 : 1);
}
