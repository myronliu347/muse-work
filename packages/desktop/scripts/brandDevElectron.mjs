/**
 * Rebrand the stock Electron.app used by `pnpm dev` on macOS.
 *
 * Dock / Cmd+Tab / menu-bar / About panel names & icons come from the
 * Electron.app bundle at launch time; `app.setName()` cannot fully override
 * them. This script patches Info.plist + electron.icns (idempotent).
 *
 * Breaks pnpm hardlinks before rewriting so we don't mutate the shared store.
 */

import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DESIRED_NAME = "Muse developing";

if (process.platform !== "darwin") {
  process.exit(0);
}

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const sourceIconPng = join(packageRoot, "assets", "icon.png");

function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {
    // fall through
  }
  return "0.0.0";
}

const DESIRED_VERSION = readPackageVersion();

let electronBin;
try {
  electronBin = require("electron");
} catch (err) {
  console.warn("[brand-dev-electron] electron not installed; skip", err);
  process.exit(0);
}

const contentsDir = resolve(electronBin, "../..");
const plistPath = join(contentsDir, "Info.plist");
const icnsPath = join(contentsDir, "Resources", "electron.icns");

if (!existsSync(plistPath)) {
  console.warn(`[brand-dev-electron] Info.plist not found: ${plistPath}`);
  process.exit(0);
}

function plistGet(key) {
  try {
    return execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print :${key}`, plistPath],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

function plistSet(key, value) {
  try {
    execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Set :${key} ${value}`, plistPath],
      { stdio: "ignore" },
    );
  } catch {
    execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Add :${key} string ${value}`, plistPath],
      { stdio: "ignore" },
    );
  }
}

function breakHardlinkAndWrite(filePath, bytes) {
  if (existsSync(filePath)) unlinkSync(filePath);
  writeFileSync(filePath, bytes);
}

function ensurePlistBranded() {
  const currentName = plistGet("CFBundleName");
  const currentDisplay = plistGet("CFBundleDisplayName");
  const currentVersion = plistGet("CFBundleShortVersionString");
  if (
    currentName === DESIRED_NAME &&
    currentDisplay === DESIRED_NAME &&
    currentVersion === DESIRED_VERSION
  ) {
    return false;
  }

  const original = readFileSync(plistPath);
  breakHardlinkAndWrite(plistPath, original);

  plistSet("CFBundleName", DESIRED_NAME);
  plistSet("CFBundleDisplayName", DESIRED_NAME);
  plistSet("CFBundleShortVersionString", DESIRED_VERSION);
  plistSet("CFBundleVersion", DESIRED_VERSION);
  return true;
}

function buildIcnsFromPng(pngPath) {
  const work = mkdtempSync(join(tmpdir(), "muse-electron-icon-"));
  const iconset = join(work, "icon.iconset");
  mkdirSync(iconset);

  const entries = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];

  for (const [px, name] of entries) {
    execFileSync(
      "sips",
      ["-z", String(px), String(px), pngPath, "--out", join(iconset, name)],
      { stdio: "ignore" },
    );
  }

  const outIcns = join(work, "electron.icns");
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", outIcns], {
    stdio: "ignore",
  });
  const bytes = readFileSync(outIcns);
  rmSync(work, { recursive: true, force: true });
  return bytes;
}

function ensureIconBranded() {
  if (!existsSync(sourceIconPng) || !existsSync(icnsPath)) {
    return false;
  }

  // Marker so we don't rebuild icns every launch.
  const marker = join(contentsDir, "Resources", ".muse-branded-icon");
  const pngLen = readFileSync(sourceIconPng).length;
  const markerKey = `${pngLen}:${DESIRED_NAME}`;
  if (existsSync(marker) && readFileSync(marker, "utf8") === markerKey) {
    return false;
  }

  const icnsBytes = buildIcnsFromPng(sourceIconPng);
  breakHardlinkAndWrite(icnsPath, icnsBytes);
  writeFileSync(marker, markerKey);
  return true;
}

let changed = false;
changed = ensurePlistBranded() || changed;
try {
  changed = ensureIconBranded() || changed;
} catch (err) {
  console.warn("[brand-dev-electron] icon branding failed:", err);
}

if (changed) {
  const appPath = resolve(contentsDir, "..");
  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
      stdio: "ignore",
    });
  } catch {
    // codesign may be unavailable; branding still usually works.
  }
  console.log(
    `[brand-dev-electron] branded → name="${DESIRED_NAME}" version=${DESIRED_VERSION} icon=assets/icon.png`,
  );
}
