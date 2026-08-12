import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    reporter: "dot",
    environment: "node",
    // Muse MVP: apiClient (+ future muse/*) only. Wave-era UI tests need
    // wave-webview-fixtures which we intentionally dropped.
    include: ["tests/apiClient.test.ts", "tests/muse/**/*.test.ts"],
    exclude: ["node_modules"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/muse/**"],
      exclude: ["src/**/*.css"],
    },
  },
});
