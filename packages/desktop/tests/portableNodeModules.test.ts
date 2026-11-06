import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyTree, makeTreePortable } from "../scripts/portableNodeModules.mjs";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-nm-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("makeTreePortable", () => {
  it("rewrites an in-tree absolute symlink so the tree still works after it is moved", () => {
    const root = tempRoot();
    const store = path.join(root, "node_modules", ".pnpm", "pkg", "node_modules", "pkg");
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, "package.json"), '{"name":"pkg"}\n');
    const link = path.join(root, "node_modules", "pkg");
    fs.symlinkSync(store, link);

    makeTreePortable(root);

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(path.isAbsolute(fs.readlinkSync(link))).toBe(false);

    const moved = path.join(tempRoot(), "copied");
    copyTree(root, moved);
    const movedPkg = path.join(moved, "node_modules", "pkg", "package.json");
    expect(fs.readFileSync(movedPkg, "utf8")).toBe('{"name":"pkg"}\n');
    expect(fs.realpathSync(path.dirname(movedPkg))).toBe(
      fs.realpathSync(path.join(moved, "node_modules", ".pnpm", "pkg", "node_modules", "pkg")),
    );
  });

  it("copies a symlink that points outside the tree", () => {
    const root = tempRoot();
    const outside = path.join(tempRoot(), "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "payload.txt"), "from-outside");
    const link = path.join(root, "payload.txt");
    fs.symlinkSync(outside + "/payload.txt", link);

    makeTreePortable(root);

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(link, "utf8")).toBe("from-outside");
    fs.writeFileSync(path.join(outside, "payload.txt"), "changed");
    expect(fs.readFileSync(link, "utf8")).toBe("from-outside");
  });
});
