#!/usr/bin/env node
/**
 * Sync @muse-work/webview dist into packages/desktop/webview and generate
 * index.html for BrowserWindow.loadFile.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const webviewDist = path.resolve(desktopRoot, "../webview/dist");
const outDir = path.join(desktopRoot, "webview");

// Muse webview talks to localhost HTTP + WS (not Wave IPC).
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
].join("; ");

for (const file of ["chat.js", "chat.css", "terminal.js", "terminal.css"]) {
  if (!fs.existsSync(path.join(webviewDist, file))) {
    console.error(
      `[syncWebview] Missing ${file} in ${webviewDist}. Run \`pnpm -F @muse-work/webview build\` first.`,
    );
    process.exit(1);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(
  path.join(webviewDist, "chat.js"),
  path.join(outDir, "chat.js"),
);
fs.copyFileSync(
  path.join(webviewDist, "terminal.js"),
  path.join(outDir, "terminal.js"),
);

const chatCss = fs.readFileSync(path.join(webviewDist, "chat.css"), "utf-8");
const terminalCss = fs.readFileSync(
  path.join(webviewDist, "terminal.css"),
  "utf-8",
);
const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Muse</title>
  <style>
    html, body, #root { background: #111111; color-scheme: dark; }
    html[data-theme="light"], html[data-theme="light"] body, html[data-theme="light"] #root {
      background: #fcfcfc; color-scheme: light;
    }
  </style>
  <style>
${chatCss}
${terminalCss}
</style>
</head>
<body>
  <div id="root"></div>
  <script src="./chat.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf-8");
console.log("[syncWebview] webview synced to", outDir);
