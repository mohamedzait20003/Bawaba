import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    webhooks: "src/webhooks.ts",
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2023",
  dts: true,
  clean: true,
});
