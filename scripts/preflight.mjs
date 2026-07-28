#!/usr/bin/env node
// Verify required runtime packages are installed. Prints a clear install
// command when anything is missing, then exits non-zero.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));

// Packages this app needs at runtime beyond framework defaults.
const REQUIRED = ["ai", "@ai-sdk/openai-compatible", "zod"];

const missing = [];
for (const name of REQUIRED) {
  try {
    require.resolve(name);
  } catch {
    const pinned = pkg.dependencies?.[name];
    missing.push(pinned ? `${name}@${pinned}` : name);
  }
}

if (missing.length === 0) {
  console.log(`preflight: OK (${REQUIRED.length} packages present)`);
  process.exit(0);
}

console.error("preflight: missing required packages:");
for (const m of missing) console.error(`  - ${m}`);
console.error("\nInstall with:");
console.error(`  bun add ${missing.join(" ")}`);
console.error(`  # or: npm install ${missing.join(" ")}`);
process.exit(1);
