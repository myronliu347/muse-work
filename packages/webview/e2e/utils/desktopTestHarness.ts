import { test as base, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Desktop variant of the webview test harness: loads the same shared webview
 * bundle but sets `window.museHostType = 'desktop'` before the bundle runs so
 * the entry point mounts DesktopApp instead of ChatApp. Waits for the
 * desktop-loading element (DesktopApp's first render) instead of
 * chat-container; tests then push `desktopWorkdirState` to mount the layout.
 */
type DesktopTestContext = {
  webviewPage: Page;
};

export const test = base.extend<DesktopTestContext>({
  webviewPage: async ({ page }, use) => {
    page.on("pageerror", (error) => {
      console.error("Page error:", error);
    });

    const webviewDistPath = path.join(process.cwd(), "dist");

    const codiconsCssPath = path.join(
      process.cwd(),
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
      "codicon.css",
    );
    const codiconsTtfPath = path.join(
      process.cwd(),
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
      "codicon.ttf",
    );

    await page.route("vscode-webview://**", (route, request) => {
      const url = new URL(request.url());
      const pathname = url.pathname;
      const filename = pathname.substring(1);

      if (
        filename === "codicons/codicon.css" &&
        fs.existsSync(codiconsCssPath)
      ) {
        route.fulfill({
          status: 200,
          contentType: "text/css",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: fs.readFileSync(codiconsCssPath),
        });
        return;
      }
      if (
        filename === "codicons/codicon.ttf" &&
        fs.existsSync(codiconsTtfPath)
      ) {
        route.fulfill({
          status: 200,
          contentType: "font/ttf",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: fs.readFileSync(codiconsTtfPath),
        });
        return;
      }

      const filePath = path.join(webviewDistPath, filename);

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filename);

        let contentType = "application/octet-stream";
        if (ext === ".js") contentType = "application/javascript";
        else if (ext === ".css") contentType = "text/css";
        else if (ext === ".ttf") contentType = "font/ttf";
        else if (ext === ".woff") contentType = "font/woff";
        else if (ext === ".woff2") contentType = "font/woff2";

        route.fulfill({
          status: 200,
          contentType,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: content,
        });
      } else {
        route.fulfill({
          status: 404,
          body: `File not found: ${filename}`,
        });
      }
    });

    const testHtml = `
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Muse</title>
    <!-- Base resolves relative URLs (e.g. the terminal chunk's ./terminal.js)
         against the routed vscode-webview scheme so the harness serves them. -->
    <base href="vscode-webview://mock-extension-id/">
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/codicons/codicon.css">
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/chat.css">
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/terminal.css">
    <style>
        body {
            margin: 0;
        }

        #root {
            width: 100%;
            height: 100vh;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        ${mockDesktopApiJs}
    </script>
    <script src="vscode-webview://mock-extension-id/chat.js"></script>
</body>
</html>`;

    // Muse Bot loads its transcript on mount. Pass-through has no server, so
    // an unstubbed request paints "Failed to fetch" on the home screen.
    await page.route("**/assistant/messages**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [], hasMore: false }),
      });
    });
    await page.route("**/assistant/queue", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    });
    await page.route("**/assistant/session", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    await page.setContent(testHtml);

    // hostBridge answers `desktopReady` by immediately pushing
    // `desktopWorkdirState`, so the empty loading stub is only on-screen for a
    // frame. Wait for the mounted sidebar instead — that proves DesktopApp +
    // ChatApp are up and the message listener is attached.
    await page.waitForSelector('[data-testid="desktop-sidebar"]', {
      timeout: 5000,
    });

    await use(page);
  },
});

/**
 * Mock host bridge: same surface as the VS Code mock plus the desktop host
 * marker. The Electron preload script sets window.museHostType before the
 * bundle runs; here we do it inline in the mock script.
 */
const mockDesktopApiJs = `
    window.process = {
        env: {
            NODE_ENV: 'production'
        }
    };

    // Skip Muse HTTP/WS hostBridge — tests drive the UI via injected messages.
    window.__MUSE_E2E_PASS_THROUGH__ = true;

    // Select the desktop root component (mirrors the Electron preload script).
    window.museHostType = 'desktop';

    let messageHandlers = [];

    window.simulateExtensionMessage = (message) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: message
        }));
    };

    window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
            if (!window.testMessages) window.testMessages = [];
            window.testMessages.push(message);
            window.dispatchEvent(new CustomEvent('vscode-message', { detail: message }));
            // Bootstrap workdir so DesktopApp leaves the loading stub (hostBridge
            // used to do this on desktopReady; pass-through leaves it to us).
            if (message && message.command === 'desktopReady') {
                queueMicrotask(() => {
                    window.simulateExtensionMessage({
                        command: 'desktopWorkdirState',
                        recentWorkdirs: [],
                    });
                });
            }
        },
        setState: (state) => {},
        getState: () => ({})
    });

    window.getTestMessages = () => window.testMessages || [];
    window.clearTestMessages = () => { window.testMessages = []; };
`;

export { expect };
