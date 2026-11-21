import { existsSync, readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Workspace packages resolve to their TypeScript source, so tests never need a build first.
const conditions = ["@bawabajs/source"];

// One Vitest project per package, named after its folder (run one with `vitest run --project core`).
const packageNames = existsSync("packages")
  ? readdirSync("packages", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

// Sandbox contract tests (test/contract/) run only in contract.yml, which sets BAWABA_CONTRACT=1.
const contract = process.env.BAWABA_CONTRACT === "1";

const projects = packageNames.map((name) => ({
  extends: true,
  test: {
    name,
    root: `packages/${name}`,
    include: contract ? ["test/contract/**/*.test.ts"] : ["test/**/*.test.ts"],
    exclude: contract ? [] : ["test/contract/**"],
  },
}));

// The validation tooling (tools/) is never published, but its receiver and scrubber are tested like the packages.
if (!contract && existsSync("tools/test")) {
  projects.push({ extends: true, test: { name: "tools", root: "tools", include: ["test/**/*.test.ts"], exclude: [] } });
}

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    passWithNoTests: true,
    // Vitest rejects an empty project list, so leave it unset until a package exists.
    ...(projects.length > 0 ? { projects } : {}),
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      thresholds: {
        "packages/core/src/{errors,money,encoding,crypto}.ts": { lines: 100, branches: 100, functions: 100, statements: 100 },
        "packages/core/src/http/**": { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
