import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    reporter: "dot",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules"],
  },
});
