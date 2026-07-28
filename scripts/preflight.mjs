#!/usr/bin/env node
// Verify required runtime packages and environment variables are present.
// Prints clear install commands / missing-variable messages when anything
// is missing, then exits non-zero.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));

// Packages this app needs at runtime beyond framework defaults.
// Shared with scripts/install-required.sh.
import { REQUIRED } from "./required-packages.mjs";
import { REQUIRED_ENV } from "./required-env.mjs";

const pad = (s, n) => String(s).padEnd(n, " ");

// ---- Package checks ------------------------------------------------------

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

// ---- Lockfile pin verification -------------------------------------------
// Any required package declared with an exact version in package.json (no ^ or
// ~ range) must also be pinned to that exact version in the lockfile.
function readLockfile() {
  const bunLock = resolve(here, "../bun.lock");
  if (existsSync(bunLock)) {
    const raw = readFileSync(bunLock, "utf8").replace(/,(\s*[}\]])/g, "$1");
    try {
      return { kind: "bun", data: JSON.parse(raw) };
    } catch {
      return { kind: "bun", data: null };
    }
  }
  const npmLock = resolve(here, "../package-lock.json");
  if (existsSync(npmLock)) {
    try {
      return { kind: "npm", data: JSON.parse(readFileSync(npmLock, "utf8")) };
    } catch {
      return { kind: "npm", data: null };
    }
  }
  return { kind: null, data: null };
}

function lockedVersion(lock, name) {
  if (!lock.data) return null;
  if (lock.kind === "bun") {
    const entry = lock.data.packages?.[name];
    const spec = Array.isArray(entry) ? entry[0] : null;
    if (typeof spec !== "string") return null;
    return spec.slice(spec.lastIndexOf("@") + 1) || null;
  }
  const entry =
    lock.data.packages?.[`node_modules/${name}`] ?? lock.data.dependencies?.[name] ?? null;
  return entry?.version ?? null;
}

const isExact = (v) => typeof v === "string" && /^\d+\.\d+\.\d+/.test(v);
const lock = readLockfile();
const pinProblems = [];

if (lock.kind && !lock.data) {
  pinProblems.push({ name: "(lockfile)", detail: `could not parse ${lock.kind} lockfile` });
} else if (lock.kind) {
  for (const name of REQUIRED) {
    const expected = expectedVersion(name);
    if (!isExact(expected)) continue; // range-declared packages are not pin-enforced
    const locked = lockedVersion(lock, name);
    if (!locked) {
      pinProblems.push({ name, detail: `expected ${expected}, not found in ${lock.kind} lockfile` });
    } else if (locked !== expected) {
      pinProblems.push({ name, detail: `expected ${expected}, lockfile has ${locked}` });
    }
  }
}

// ---- Environment variable checks -----------------------------------------

const envMissing = [];
const envPresent = [];
for (const env of REQUIRED_ENV) {
  const value = process.env[env.name];
  if (value && value.trim().length > 0) {
    envPresent.push(env);
  } else if (env.required) {
    envMissing.push(env);
  }
}

// ---- Reporting -----------------------------------------------------------

const packageOk = missing.length === 0 && pinProblems.length === 0;
const envOk = envMissing.length === 0;

if (packageOk && envOk) {
  console.log(`preflight: OK — all ${REQUIRED.length} required packages are installed`);
  for (const p of present) {
    console.log(`  ✓ ${pad(p.name, 28)} ${p.installed ?? "?"} (expected ${p.expected ?? "any"})`);
  }
  if (lock.kind) console.log(`preflight: OK — pinned versions match the ${lock.kind} lockfile`);
  if (envPresent.length > 0) {
    console.log(`preflight: OK — all required environment variable(s) are set`);
    for (const e of envPresent) {
      console.log(`  ✓ ${pad(e.name, 28)} ${e.description}`);
    }
  }
  process.exit(0);
}

if (!packageOk) {
  if (pinProblems.length > 0) {
    console.error(`preflight: FAILED — ${pinProblems.length} lockfile pin mismatch(es)\n`);
    const w = Math.max(7, ...pinProblems.map((p) => p.name.length));
    for (const p of pinProblems) console.error(`  ✗ ${pad(p.name, w)}  ${p.detail}`);
    console.error("\nRe-pin with:\n  ./scripts/install-required.sh");
    if (missing.length === 0) console.error("");
  }

  if (missing.length > 0) {
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
    console.error("  ./scripts/install-required.sh   # installs all required packages, pinned");
    console.error("\nOr run the package-manager command directly:");
    const primary = commands[packageManager];
    const primaryNote = packageManager !== "npm" ? "  # recommended" : "";
    console.error(`  ${primary}${primaryNote}`);

    if (packageManager !== "npm") console.error(`  # or: npm install ${installArgs}`);
  }
}

if (!envOk) {
  if (!packageOk) console.error("");
  const nameWidth = Math.max(7, ...envMissing.map((e) => e.name.length));
  console.error(`preflight: FAILED — ${envMissing.length} required environment variable(s) missing\n`);
  console.error(`  ${pad("VARIABLE", nameWidth)}  DESCRIPTION`);
  console.error(`  ${pad("-".repeat(nameWidth), nameWidth)}  -----------`);
  for (const e of envMissing) {
    console.error(`  ${pad(e.name, nameWidth)}  ${e.description}`);
  }
  console.error("\nSet the missing variables in your environment or .env file before running the app.");
  console.error("For Lovable Cloud projects, these secrets are managed in Project Settings → Secrets.");
}

process.exit(1);
