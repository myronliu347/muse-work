import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    reporters: ["dot"],
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules"],
  },
});
