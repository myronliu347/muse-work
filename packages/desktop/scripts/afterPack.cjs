/**
 * Ad-hoc sign so the .app can still be opened when the Muse Work
 * certificate is missing. electron-builder replaces this signature
 * when that identity is present.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log("[afterPack] ad-hoc codesign", appPath);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
