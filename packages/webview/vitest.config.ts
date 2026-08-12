import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    reporter: "dot",
    environment: "node",
    // Muse MVP: apiClient + muse/* + sidebar component tests.
    // Wave-era tests/webview/* still need fixtures we dropped.
    include: [
      "tests/apiClient.test.ts",
      "tests/muse/**/*.test.ts",
      "tests/components/**/*.test.tsx",
    ],
    exclude: ["node_modules"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/muse/**"],
      exclude: ["src/**/*.css"],
    },
  },
});
