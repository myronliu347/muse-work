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
    reporter: "dot",
    environment: "node",
    include: [
      "tests/apiClient.test.ts",
      "tests/muse/**/*.test.ts",
      "tests/muse/**/*.test.tsx",
      "tests/components/**/*.test.tsx",
      "tests/stores/**/*.test.ts",
      "tests/utils/**/*.test.ts",
      "tests/reducers/**/*.test.ts",
      "tests/webview/slash-commands.test.tsx",
      "tests/webview/clearChat.test.tsx",
      "tests/webview/rewindPopup.test.tsx",
      "tests/webview/rewind.test.tsx",
      "tests/webview/permissionModeCycle.test.tsx",
      "tests/webview/permissionModeDropdown.test.tsx",
      "tests/webview/terminalPane.test.tsx",
      "tests/webview/panelWorkdirScope.test.tsx",
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
