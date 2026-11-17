// Smoke test: packs every package (after `pnpm build`), installs the tarballs into a throwaway npm consumer
// outside the workspace, then imports every entry point with both `import` (ESM) and `require` (CJS).
// It also checks that the packed manifests contain no `workspace:` or `catalog:` ranges.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  name: string;
  version: string;
  exports?: Record<string, unknown>;
}

const ROOT = join(import.meta.dirname, "..", "..");
const TMP = join(import.meta.dirname, ".tmp");
const TARBALLS = join(TMP, "tarballs");
const CONSUMER = join(TMP, "consumer");

const run = (command: string, cwd: string): string => execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TARBALLS, { recursive: true });
mkdirSync(CONSUMER, { recursive: true });

const packagesDir = join(ROOT, "packages");
const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(packagesDir, d.name, "package.json")))
  .map((d) => {
    const dir = join(packagesDir, d.name);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
    if (!existsSync(join(dir, "dist"))) throw new Error(`${pkg.name} has no dist/: run \`pnpm build\` first`);
    return { dir, pkg };
  });

// 1. Pack. pnpm rewrites workspace: and catalog: ranges into real versions.
const tarballs = new Map<string, string>();
for (const { dir, pkg } of packages) {
  run(`pnpm pack --pack-destination "${TARBALLS}"`, dir);
  const file = readdirSync(TARBALLS).find((f) => f.startsWith(`${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}`) && f.endsWith(".tgz"));
  if (!file) throw new Error(`could not find the tarball for ${pkg.name}`);
  tarballs.set(pkg.name, `file:../tarballs/${file}`);
}

// 2. Install into a plain npm project, outside the pnpm workspace. Overrides keep npm off the registry.
const deps = Object.fromEntries(tarballs);
writeFileSync(join(CONSUMER, "package.json"), JSON.stringify({ name: "bawaba-smoke-consumer", private: true, dependencies: deps, overrides: deps }, null, 2));
run("npm install --no-audit --no-fund --ignore-scripts --loglevel=error", CONSUMER);

// 3. Packed manifests must not leak workspace protocols.
const problems: string[] = [];
for (const { pkg } of packages) {
  const installed = readFileSync(join(CONSUMER, "node_modules", ...pkg.name.split("/"), "package.json"), "utf8");
  if (/"(workspace|catalog):/.test(installed)) problems.push(`${pkg.name}: packed package.json still contains workspace: or catalog: ranges`);
}

// 4. Import every entry point both ways.
const specifiers = packages.flatMap(({ pkg }) =>
  Object.keys(pkg.exports ?? { ".": "" })
    .filter((key) => key !== "./package.json")
    .map((key) => (key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`)),
);
const check = `if (typeof mod.VERSION !== "string" && typeof mod.GATEWAY !== "string") throw new Error(spec + " exports neither VERSION nor GATEWAY");`;
writeFileSync(
  join(CONSUMER, "esm.mjs"),
  `const specs = ${JSON.stringify(specifiers)};\nfor (const spec of specs) { const mod = await import(spec); ${check} }\nconsole.log("ESM: " + specs.length + " entry points OK");\n`,
);
writeFileSync(
  join(CONSUMER, "cjs.cjs"),
  `const specs = ${JSON.stringify(specifiers)};\nfor (const spec of specs) { const mod = require(spec); ${check} }\nconsole.log("CJS: " + specs.length + " entry points OK");\n`,
);
for (const file of ["esm.mjs", "cjs.cjs"]) {
  try {
    process.stdout.write(run(`node ${file}`, CONSUMER));
  } catch (error) {
    problems.push(`${file}: ${(error as { stderr?: string }).stderr ?? String(error)}`);
  }
}

if (problems.length > 0) {
  const formattedProblems = problems.map((p) => "  - " + p).join("\n");
  console.error(`smoke: ${problems.length} problem(s)\n${formattedProblems}`);
  process.exit(1);
}

rmSync(TMP, { recursive: true, force: true });
console.log(`smoke: ${packages.length} packages packed, installed and imported`);
