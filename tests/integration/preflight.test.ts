import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(process.cwd(), "scripts", "preflight.mjs");

function runIn(dir: string) {
  return spawnSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" });
}

function scaffold(pkgs: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "0.0.0" }));
  const nm = join(dir, "node_modules");
  for (const p of pkgs) {
    const target = join(nm, ...p.split("/"));
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, "package.json"),
      JSON.stringify({ name: p, version: "1.0.0" }),
    );
  }
  return dir;
}

describe("preflight script (integration)", () => {
  it("exits 0 when all required packages are installed", () => {
    // Run against the real project which has all deps installed.
    const res = spawnSync("node", [SCRIPT], { cwd: process.cwd(), encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/required packages/i);
  });

  it("exits non-zero and prints install command when a package is missing", () => {
    const dir = scaffold(["zod"]); // intentionally missing ai, etc.
    const res = runIn(dir);
    expect(res.status).not.toBe(0);
    const output = res.stdout + res.stderr;
    expect(output).toMatch(/missing/i);
    expect(output).toMatch(/npm install/i);
    expect(output).toContain("ai@");
  });
});
