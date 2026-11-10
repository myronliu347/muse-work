import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  compareVersions,
  nextReleaseVersion,
  parseChoice,
  parseReleaseArgs,
  desktopShellChanged,
  parseVersion,
  shellPackageFile,
  versionedPackageFiles,
} from "./release.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("release bumps whichever is newer, the packages or the tag", () => {
  assert.equal(nextReleaseVersion("0.1.0", null, "patch"), "0.1.1");
  assert.equal(nextReleaseVersion("0.2.0", "0.1.0", "patch"), "0.2.1");
  assert.equal(nextReleaseVersion("0.1.0", "0.1.5", "patch"), "0.1.6");
  assert.equal(nextReleaseVersion("0.1.9", "0.1.9", "minor"), "0.2.0");
  assert.equal(nextReleaseVersion("0.2.3", "0.2.3", "major"), "1.0.0");
  assert.equal(nextReleaseVersion("0.1.0", "0.1.0", "1.4.0"), "1.4.0");
});

test("version order treats 0.1.10 as newer than 0.1.9", () => {
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("v0.2.0", "0.2.0"), 0);
  assert.equal(parseVersion("nope"), null);
});

test("choice accepts the name or its menu number", () => {
  assert.equal(parseChoice("2"), "minor");
  assert.equal(parseChoice("Major"), "major");
  assert.equal(parseChoice("nope"), null);
});

test("flags leave the bump unset so the prompt can ask", () => {
  assert.deepEqual(parseReleaseArgs(["--dry-run"]), {
    flags: { dryRun: true, help: false },
    kind: null,
  });
  assert.equal(parseReleaseArgs(["minor"]).kind, "minor");
});

test("every workspace package with a version is released together", () => {
  const names = versionedPackageFiles(root).map((file) => path.basename(path.dirname(file)));
  assert.deepEqual(names, ["agent", "desktop", "plugin-sdk", "provider", "server", "webview"]);
});

test("shell rises when desktop src or package.json changed since the tag", () => {
  assert.equal(desktopShellChanged(["packages/desktop/src/main/index.ts"]), true);
  assert.equal(desktopShellChanged(["packages/desktop/package.json"]), true);
  assert.equal(desktopShellChanged(["packages/desktop/src"]), true);
  assert.equal(
    desktopShellChanged(["packages/webview/src/app.tsx", "packages/desktop/scripts/packHot.mjs"]),
    false,
  );
  assert.equal(desktopShellChanged([]), false);
  const desktop = JSON.parse(fs.readFileSync(shellPackageFile(root), "utf8"));
  assert.ok(parseVersion(desktop.version));
  assert.ok(parseVersion(desktop.shellVersion));
});
