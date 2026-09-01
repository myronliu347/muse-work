import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const frontendConfig = {
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: "dist/chat.js",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "warning",
  loader: {
    ".ttf": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
    ".png": "dataurl",
    ".webp": "dataurl",
    ".svg": "dataurl",
  },
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
};

// Desktop-only terminal chunk (xterm.js). Exposes `window.WaveTerminal` and is
// lazy-injected by TerminalPane, so xterm stays out of the main webview bundle.
const terminalConfig = {
  ...frontendConfig,
  entryPoints: ["src/terminal-entry.ts"],
  globalName: "WaveTerminal",
  outfile: "dist/terminal.js",
};

async function main() {
  // Desktop terminal chunk (xterm). Build by default; set MUSE_SKIP_TERMINAL=1 to skip.
  const skipTerminal = process.env.MUSE_SKIP_TERMINAL === "1";
  const ctx = await esbuild.context(frontendConfig);
  const terminalCtx = skipTerminal
    ? null
    : await esbuild.context(terminalConfig);
  if (watch) {
    console.log("[watch] frontend build started");
    await ctx.watch();
    if (terminalCtx) await terminalCtx.watch();
  } else {
    console.log("[build] frontend started");
    await ctx.rebuild();
    await ctx.dispose();
    if (terminalCtx) {
      await terminalCtx.rebuild();
      await terminalCtx.dispose();
    } else {
      console.log("[build] skipped terminal.js (MUSE_SKIP_TERMINAL=1)");
    }
    console.log("[build] frontend finished");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
