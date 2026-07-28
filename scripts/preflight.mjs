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
const REQUIRED = ["ai", "@ai-sdk/openai-compatible", "zod"];

const missing = [];
for (const name of REQUIRED) {
  try {
    require.resolve(name);
  } catch {
    const version = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    missing.push({ name, specifier: version ? `${name}@${version}` : name });
  }
}

if (missing.length === 0) {
  console.log(`preflight: OK (${REQUIRED.length} packages present)`);
  process.exit(0);
}

const installArgs = missing.map((m) => m.specifier).join(" ");
const packageManager = existsSync(resolve(here, "../bun.lockb"))
  ? "bun"
  : existsSync(resolve(here, "../pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(resolve(here, "../yarn.lock"))
      ? "yarn"
      : "npm";

const commands = {
  npm: `npm install ${installArgs}`,
  bun: `bun add ${installArgs}`,
  pnpm: `pnpm add ${installArgs}`,
  yarn: `yarn add ${installArgs}`,
};

console.error("Error: required packages are missing:");
for (const m of missing) console.error(`  - ${m.name}`);
console.error("\nInstall the missing packages with:");
const primary = commands[packageManager];
const primaryNote = packageManager !== "npm" ? "  # recommended" : "";
console.error(`  ${primary}${primaryNote}`);
if (packageManager !== "npm") console.error(`  # or: npm install ${installArgs}`);
process.exit(1);
