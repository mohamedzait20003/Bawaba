// Runtime portability check: imports every built ESM entry point under another JavaScript runtime.
// Usage (after `pnpm build`): node --experimental-strip-types scripts/smoke/runtimes.ts <bun|deno|node>
// Any Node-only API reached at import time fails the run.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface PackageJson {
  name: string;
  exports?: Record<string, { import?: { default?: string } } | string>;
}

const runtime = process.argv[2];
const COMMANDS: Record<string, string[]> = {
  bun: ["bun", "run"],
  deno: ["deno", "run", "--allow-read", "--allow-env"],
  node: [process.execPath],
};
const command = runtime ? COMMANDS[runtime] : undefined;
if (!command) {
  console.error(`usage: runtimes.ts <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(2);
}

const ROOT = join(import.meta.dirname, "..", "..");
const packagesDir = join(ROOT, "packages");
const entries: string[] = [];
for (const folder of readdirSync(packagesDir)) {
  const manifest = join(packagesDir, folder, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as PackageJson;
  for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    if (key === "./package.json" || typeof target === "string") continue;
    const file = target.import?.default;
    if (!file) continue;
    const path = join(packagesDir, folder, file);
    if (!existsSync(path)) throw new Error(`${pkg.name} ${key}: ${file} is missing; run \`pnpm build\` first`);
    entries.push(pathToFileURL(path).href);
  }
}

const tmp = join(import.meta.dirname, ".tmp");
mkdirSync(tmp, { recursive: true });
const probe = join(tmp, "runtimes-probe.mjs");
writeFileSync(
  probe,
  [
    `const entries = ${JSON.stringify(entries)};`,
    "for (const entry of entries) await import(entry);",
    `const name = typeof Deno !== "undefined" ? "Deno " + Deno.version.deno : typeof Bun !== "undefined" ? "Bun " + Bun.version : "Node " + process.versions.node;`,
    `console.log(name + ": " + entries.length + " entry points imported");`,
    "",
  ].join("\n"),
);

const [bin, ...args] = command;
execFileSync(bin as string, [...args, probe], { stdio: "inherit" });
