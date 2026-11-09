import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      // Existing app tests must not call the intranet plugin manifest.
      MUSE_NETEASE_PLUGIN: "0",
    },
  },
});
