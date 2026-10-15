/**
 * Sign the whole .app in one pass. electron-builder's per-file signer
 * walks every binary, so mac.identity stays null.
 *
 * MUSE_CODESIGN_IDENTITY names a local certificate. Unset signs ad-hoc.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

function signingIdentity() {
  const name = process.env.MUSE_CODESIGN_IDENTITY;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const identity = signingIdentity();
  console.log(`[afterPack] codesign identity=${identity ?? "null"}`, appPath);
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", identity ?? "-", appPath],
    { stdio: "inherit" },
  );
};
