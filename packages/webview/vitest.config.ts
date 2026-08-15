import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "wave-webview-fixtures": path.join(
        root,
        "tests/fixtures/waveWebviewFixtures.ts",
      ),
    },
  },
  test: {
    globals: true,
    reporters: ["dot"],
    environment: "node",
    environmentMatchGlobs: [
      ["**/*.test.tsx", "jsdom"],
      ["**/*.test.ts", "node"],
    ],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/muse/**"],
      exclude: ["src/**/*.css"],
    },
  },
});
