/**
 * Muse ships Apple-silicon-only macOS builds. The dmg must not contain an
 * x86_64 main binary or an x86_64 native addon: those would silently fall back
 * to Rosetta and stop working when Rosetta is removed in a future macOS.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function lipoArchs(file) {
  const output = execFileSync("lipo", ["-archs", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output.split(/\s+/).filter(Boolean);
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function verifyMacArch(desktopRoot) {
  if (process.platform !== "darwin") {
    throw new Error("[verifyMacArch] macOS-only check");
  }
  const releaseDir = path.join(desktopRoot, "release", "mac-arm64");
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`[verifyMacArch] missing release dir: ${releaseDir}`);
  }
  const appName = fs
    .readdirSync(releaseDir)
    .find((name) => name.endsWith(".app"));
  if (!appName) {
    throw new Error(`[verifyMacArch] no .app in ${releaseDir}`);
  }
  const app = path.join(releaseDir, appName);
  const resources = path.join(app, "Contents", "Resources");
  const checks = [
    {
      label: "main executable",
      file: path.join(app, "Contents", "MacOS", "Muse"),
    },
    {
      label: "Electron Framework",
      file: path.join(
        app,
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Versions",
        "A",
        "Electron Framework",
      ),
    },
  ];

  const files = walk(resources);
  const nativeModules = files.filter((file) => file.endsWith(".node"));
  if (nativeModules.length === 0) {
    throw new Error("[verifyMacArch] no native .node modules found");
  }
  for (const file of nativeModules) {
    checks.push({
      label: path.relative(resources, file),
      file,
    });
  }

  const rg = files.find(
    (file) =>
      path.basename(file) === "rg" &&
      file.includes("ripgrep") &&
      file.includes(`${path.sep}bin${path.sep}`),
  );
  if (!rg) {
    throw new Error("[verifyMacArch] bundled ripgrep binary not found");
  }
  checks.push({
    label: path.relative(resources, rg),
    file: rg,
  });

  for (const check of checks) {
    if (!fs.existsSync(check.file)) {
      throw new Error(`[verifyMacArch] missing ${check.label}: ${check.file}`);
    }
    const archs = lipoArchs(check.file);
    if (!archs.includes("arm64")) {
      throw new Error(
        `[verifyMacArch] ${check.label} is not arm64: ${archs.join(" ") || "unknown"}`,
      );
    }
    console.log(`[verifyMacArch] ${check.label}: ${archs.join(" ")}`);
  }
  console.log(`[verifyMacArch] ${appName} is Apple-silicon ready`);
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const desktopRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  try {
    verifyMacArch(desktopRoot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
