import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT_SRC = join(process.cwd(), "scripts", "preflight.mjs");
const LIST_SRC = join(process.cwd(), "scripts", "required-packages.mjs");

function scaffold(pkgs: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "0.0.0" }));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(SCRIPT_SRC, join(dir, "scripts", "preflight.mjs"));
  cpSync(LIST_SRC, join(dir, "scripts", "required-packages.mjs"));

  const nm = join(dir, "node_modules");
  for (const p of pkgs) {
    const target = join(nm, ...p.split("/"));
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, "package.json"),
      JSON.stringify({ name: p, version: "1.0.0", main: "index.js" }),
    );
    writeFileSync(join(target, "index.js"), "module.exports = {};");
  }
  return dir;
}

function runIn(dir: string) {
  return spawnSync("node", [join(dir, "scripts", "preflight.mjs")], {
    cwd: dir,
    encoding: "utf8",
  });
}

describe("preflight script (integration)", () => {
  it("exits 0 when all required packages are resolvable", () => {
    const res = spawnSync("node", [SCRIPT_SRC], { cwd: process.cwd(), encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/preflight: OK/i);
  });

  it("exits non-zero and prints install command when a package is missing", () => {
    const dir = scaffold(["zod"]); // intentionally missing ai, etc.
    const res = runIn(dir);
    expect(res.status).not.toBe(0);
    const output = res.stdout + res.stderr;
    expect(output).toMatch(/missing/i);
    expect(output).toMatch(/npm install/i);
    expect(output).toContain("ai");
  });
});

