import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    paymob: "src/paymob.ts",
    kashier: "src/kashier.ts",
    fawry: "src/fawry.ts",
    geidea: "src/geidea.ts",
    paytabs: "src/paytabs.ts",
    payfort: "src/payfort.ts",
    tap: "src/tap.ts",
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2023",
  dts: true,
  clean: true,
});
