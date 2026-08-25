import { defineConfig } from "tsup";

const shared = {
  format: ["cjs"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  clean: false,
  dts: false,
  external: ["electron", "node-pty"],
} as const;

export default defineConfig([
  {
    ...shared,
    entry: {
      "main/index": "src/main/index.ts",
      "main/preload": "src/main/preload.ts",
      "main/pickerPreload": "src/main/pickerPreload.ts",
    },
  },
]);
