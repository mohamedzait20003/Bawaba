// Dependency guard: enforces the package rules in docs/specifications/TECHNICAL_SPECIFICATIONS.md §2 and §9.
// Exits with code 1 and lists every violation.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";

interface PackageJson {
  name: string;
  description?: string;
  license?: string;
  sideEffects?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
}

const ROOT = join(import.meta.dirname, "..");
const GATEWAYS = ["paymob", "kashier", "fawry", "geidea", "paytabs", "payfort", "tap"];
const NOTICE = "Unofficial. Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments.";
const README_NOTICE = "Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments.";

// Packages whose runtime code must stay portable and dependency-free.
const RUNTIME = new Set(["core", ...GATEWAYS, "bawaba"]);
const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "")));

const errors: string[] = [];
const fail = (pkg: string, message: string): void => {
  errors.push(`${pkg}: ${message}`);
};

const packagesDir = join(ROOT, "packages");
const folders = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(packagesDir, d.name, "package.json")))
  .map((d) => d.name);

for (const folder of folders) {
  const dir = join(packagesDir, folder);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;

  const name = pkg.name;
  const deps = Object.keys(pkg.dependencies ?? {});
  const peers = Object.keys(pkg.peerDependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const isInternal = (d: string): boolean => d === "bawaba" || d.startsWith("@bawabajs/");

  // Metadata every published package needs.
  if (pkg.license !== "MIT") fail(name, `license must be "MIT" (found ${JSON.stringify(pkg.license)})`);

  if (!pkg.description?.includes(NOTICE)) fail(name, "description must include the unofficial notice");

  const readme = join(dir, "README.md");
  if (!existsSync(readme) || !readFileSync(readme, "utf8").includes(README_NOTICE)) {
    fail(name, "README.md must include the unofficial notice");
  }

  if (pkg.sideEffects !== false) fail(name, "sideEffects must be false");

  // Gateway packages never depend on each other, in any dependency field.
  if (GATEWAYS.includes(folder)) {
    for (const d of [...deps, ...peers, ...devDeps]) {
      const other = GATEWAYS.find((g) => d === `@bawabajs/${g}`);
      if (other && other !== folder) fail(name, `must not depend on another gateway package (${d})`);
    }
  }

  // Zero runtime dependencies outside the workspace.
  if (RUNTIME.has(folder)) {
    for (const d of deps) if (!isInternal(d)) fail(name, `runtime dependency outside @bawabajs/* is not allowed (${d})`);
    for (const d of peers) {
      const allowed = folder === "core" && d === "vitest" && pkg.peerDependenciesMeta?.vitest?.optional === true;
      if (!isInternal(d) && !allowed) fail(name, `peer dependency outside @bawabajs/* is not allowed (${d})`);
    }
  }

  // @bawabajs/testing depends on core only, so gateway packages can use it without a cycle.
  if (folder === "testing") {
    for (const d of [...deps, ...peers]) if (d !== "@bawabajs/core") fail(name, `may depend on @bawabajs/core only (${d})`);
  }

  // Direction: core depends on nothing internal; gateways on core only.
  if (folder === "core") for (const d of [...deps, ...peers]) if (isInternal(d)) fail(name, `core must not depend on ${d}`);
  if (GATEWAYS.includes(folder)) {
    for (const d of [...deps, ...peers]) if (isInternal(d) && d !== "@bawabajs/core") fail(name, `may depend on @bawabajs/core only (${d})`);
  }

  // No Node built-ins in portable runtime code.
  if (RUNTIME.has(folder)) {
    for (const file of walk(join(dir, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const bare = specifier.replace(/^node:/, "").split("/")[0] ?? specifier;
        if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare)) {
          fail(name, `${relative(ROOT, file)} imports the Node built-in "${specifier}"`);
        }
      }
    }
  }
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) yield path;
  }
}

function importSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s[^"'`;]*?\bfrom\s*["']([^"']+)["']/g, // import x from "y", export { x } from "y"
    /\bimport\s*["']([^"']+)["']/g, // import "y"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("y")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("y")
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1] ?? ""));
}

if (errors.length > 0) {
  const formattedErrors = errors.map((e) => "  - " + e).join("\n");
  console.error(`check-deps: ${errors.length} problem(s)\n${formattedErrors}`);
  process.exit(1);
}

console.log(`check-deps: ${folders.length} packages OK`);
