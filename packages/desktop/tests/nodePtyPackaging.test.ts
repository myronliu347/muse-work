import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeNodePty,
  restoreNodePty,
} from "../scripts/nodePtyPackaging.mjs";

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pty-pack-"));
  roots.push(root);
  const real = path.join(root, "store", "node-pty");
  fs.mkdirSync(path.join(real, "build", "Release"), { recursive: true });
  fs.writeFileSync(path.join(real, "build", "Release", "pty.node"), "electron-abi");
  fs.writeFileSync(path.join(real, "package.json"), '{"name":"node-pty"}\n');
  const app = path.join(root, "app");
  const nm = path.join(app, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  const rel = path.relative(nm, real);
  fs.symlinkSync(rel, path.join(nm, "node-pty"));
  return { app, real, rel };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("node-pty packaging", () => {
  it("replaces the pnpm symlink with a real directory and restores it", () => {
    const { app, real, rel } = fixture();
    const link = path.join(app, "node_modules", "node-pty");

    expect(materializeNodePty(app)).toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(link, "build", "Release", "pty.node"), "utf8")).toBe(
      "electron-abi",
    );
    expect(fs.existsSync(real)).toBe(true);

    expect(restoreNodePty(app)).toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(rel);
    expect(fs.readFileSync(path.join(real, "build", "Release", "pty.node"), "utf8")).toBe(
      "electron-abi",
    );
    expect(restoreNodePty(app)).toBe(false);
  });

  it("leaves a real node-pty directory untouched", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pty-pack-"));
    roots.push(root);
    const link = path.join(root, "node_modules", "node-pty");
    fs.mkdirSync(link, { recursive: true });
    fs.writeFileSync(path.join(link, "package.json"), "{}\n");

    expect(materializeNodePty(root)).toBe(false);
    expect(fs.lstatSync(link).isDirectory()).toBe(true);
    expect(restoreNodePty(root)).toBe(false);
  });

  it("wires mac packaging through the node-pty rebuild step", () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf8",
      ),
    ) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["dist:mac"]).toContain("node scripts/packMac.mjs");
    expect(pkg.scripts?.dev).toContain("node scripts/ensureNodePty.mjs");
  });
});
