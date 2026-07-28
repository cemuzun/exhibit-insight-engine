#!/usr/bin/env node
// Verify required runtime packages are installed. Prints a clear install
// command when anything is missing, then exits non-zero.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));

// Packages this app needs at runtime beyond framework defaults.
const REQUIRED = [
  "ai",
  "@ai-sdk/openai-compatible",
  "zod",
  "@supabase/supabase-js",
  "lucide-react",
  "sonner",
  "recharts",
  "date-fns",
  "react-hook-form",
  "@hookform/resolvers",
];

function expectedVersion(name) {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? null;
}

function installedVersion(name) {
  try {
    const manifest = require.resolve(`${name}/package.json`);
    return JSON.parse(readFileSync(manifest, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

const missing = [];
const present = [];
for (const name of REQUIRED) {
  const expected = expectedVersion(name);
  let resolved = true;
  try {
    require.resolve(name);
  } catch {
    resolved = false;
  }
  const entry = {
    name,
    expected,
    installed: resolved ? installedVersion(name) : null,
    specifier: expected ? `${name}@${expected}` : name,
  };
  (resolved ? present : missing).push(entry);
}

const pad = (s, n) => String(s).padEnd(n, " ");

if (missing.length === 0) {
  console.log(`preflight: OK — all ${REQUIRED.length} required packages are installed`);
  for (const p of present) {
    console.log(`  ✓ ${pad(p.name, 28)} ${p.installed ?? "?"} (expected ${p.expected ?? "any"})`);
  }
  process.exit(0);
}

const installArgs = missing.map((m) => m.specifier).join(" ");
const packageManager =
  existsSync(resolve(here, "../bun.lockb")) || existsSync(resolve(here, "../bun.lock"))
    ? "bun"
    : existsSync(resolve(here, "../pnpm-lock.yaml"))
      ? "pnpm"
      : existsSync(resolve(here, "../yarn.lock"))
        ? "yarn"
        : "npm";

const commands = {
  npm: `npm install ${installArgs}`,
  bun: `bun add --exact ${installArgs}`,
  pnpm: `pnpm add ${installArgs}`,
  yarn: `yarn add ${installArgs}`,
};

const nameWidth = Math.max(7, ...missing.map((m) => m.name.length));

console.error(
  `preflight: FAILED — ${missing.length} of ${REQUIRED.length} required package(s) missing\n`,
);
console.error(`  ${pad("PACKAGE", nameWidth)}  EXPECTED VERSION`);
console.error(`  ${pad("-".repeat(nameWidth), nameWidth)}  ----------------`);
for (const m of missing) {
  console.error(`  ${pad(m.name, nameWidth)}  ${m.expected ?? "(not in package.json — add it)"}`);
}
console.error("\nInstall the missing packages with:");
const primary = commands[packageManager];
const primaryNote = packageManager !== "npm" ? "  # recommended" : "";
console.error(`  ${primary}${primaryNote}`);
if (packageManager !== "npm") console.error(`  # or: npm install ${installArgs}`);
process.exit(1);

