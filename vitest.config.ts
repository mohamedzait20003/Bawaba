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
    },
  },
});
