#!/usr/bin/env node
// Quick smoke test for verify:ai.
//
//  1. Type check (tsc --noEmit) — or a full production build with --build.
//  2. A minimal runtime script run that actually imports and exercises the
//     critical AI/runtime packages, so a broken or half-installed dependency
//     fails here instead of at request time.
//
// Exits non-zero with an actionable message when either step fails.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const useBuild = args.includes("--build");

function pm() {
  if (existsSync(resolve(root, "bun.lock")) || existsSync(resolve(root, "bun.lockb"))) return "bun";
  if (existsSync(resolve(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function fail(step, hint, output) {
  console.error(`\nsmoke: FAILED — ${step}\n`);
  if (output) console.error(output.trim().split("\n").slice(-40).join("\n") + "\n");
  console.error("How to fix:");
  for (const line of hint) console.error(`  ${line}`);
  process.exit(1);
}

// ---- Step 1: compile ------------------------------------------------------

const runner = pm();
const exec = runner === "npm" ? "npx" : runner === "bun" ? "bunx" : runner === "pnpm" ? "pnpm" : "yarn";

const compileCmd = useBuild
  ? [exec, ["vite", "build", "--mode", "development"]]
  : [exec, ["tsc", "--noEmit"]];

console.log(`smoke: running ${useBuild ? "production build" : "TypeScript compile"}…`);
const compile = spawnSync(compileCmd[0], compileCmd[1], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, SMOKE: "1" },
});

if (compile.status !== 0) {
  fail(
    useBuild ? "the production build did not complete" : "TypeScript compilation reported errors",
    [
      `Re-run the failing step directly to see the full output:`,
      `  ${compileCmd[0]} ${compileCmd[1].join(" ")}`,
      `If the errors mention a missing module, run: ./scripts/install-required.sh`,
    ],
    `${compile.stdout ?? ""}\n${compile.stderr ?? ""}`,
  );
}
console.log(`smoke: OK — ${useBuild ? "build succeeded" : "no type errors"}`);

// ---- Step 2: minimal runtime script run -----------------------------------

console.log("smoke: running minimal runtime script…");
try {
  const { z } = await import("zod");
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const ai = await import("ai");

  const schema = z.object({ ok: z.boolean() });
  const parsed = schema.parse({ ok: true });
  if (parsed.ok !== true) throw new Error("zod parse returned an unexpected value");

  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: process.env.LOVABLE_API_KEY ?? "smoke-test",
  });
  const model = provider("google/gemini-2.5-flash");
  if (!model || typeof model !== "object") throw new Error("model factory returned nothing");

  if (typeof ai.generateText !== "function" || typeof ai.generateObject !== "function") {
    throw new Error("the 'ai' package is missing generateText/generateObject exports");
  }
} catch (error) {
  fail(
    "the minimal runtime script could not exercise the AI packages",
    [
      `Reason: ${error instanceof Error ? error.message : String(error)}`,
      "Reinstall the pinned runtime packages: ./scripts/install-required.sh",
      "Then re-run: npm run verify:ai",
    ],
    null,
  );
}

console.log("smoke: OK — runtime packages load and initialise correctly");
console.log("smoke: PASSED");
