/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  buildPathTree,
  type PathTreeDir,
  type PathTreeLeaf,
  type PathTreeNode,
} from "../../src/utils/pathTree";

type Item = { id: string };

function leaf(node: PathTreeNode<Item>): PathTreeLeaf<Item> {
  expect(node.kind).toBe("file");
  return node as PathTreeLeaf<Item>;
}

function dir(node: PathTreeNode<Item>): PathTreeDir<Item> {
  expect(node.kind).toBe("dir");
  return node as PathTreeDir<Item>;
}

describe("buildPathTree", () => {
  it("builds a directory tree from path segments", () => {
    const roots = buildPathTree([
      { segments: ["src", "a.ts"], path: "src/a.ts", data: { id: "a" } },
      { segments: ["lib", "c.ts"], path: "lib/c.ts", data: { id: "c" } },
    ]);
    expect(roots).toHaveLength(2);
    const src = dir(roots[0]);
    expect(src.name).toBe("src");
    expect(src.path).toBe("src");
    expect(src.fileCount).toBe(1);
    expect(leaf(src.children[0]).data.id).toBe("a");
    expect(leaf(src.children[0]).name).toBe("a.ts");
    expect(leaf(src.children[0]).path).toBe("src/a.ts");
  });

  it("merges single-child directory chains into one node", () => {
    const roots = buildPathTree([
      {
        segments: ["a", "b", "c", "file.ts"],
        path: "a/b/c/file.ts",
        data: { id: "f" },
      },
    ]);
    expect(roots).toHaveLength(1);
    const merged = dir(roots[0]);
    expect(merged.name).toBe("a/b/c");
    expect(merged.path).toBe("a/b/c");
    expect(merged.fileCount).toBe(1);
    expect(leaf(merged.children[0]).name).toBe("file.ts");
  });

  it("does not merge a dir that also has a file sibling", () => {
    const roots = buildPathTree([
      {
        segments: ["src", "components", "ui", "Button.tsx"],
        path: "src/components/ui/Button.tsx",
        data: { id: "b" },
      },
      {
        segments: ["src", "a.ts"],
        path: "src/a.ts",
        data: { id: "a" },
      },
    ]);
    const src = dir(roots[0]);
    expect(src.name).toBe("src");
    expect(src.fileCount).toBe(2);
    const names = src.children.map((c) =>
      c.kind === "dir" ? c.name : c.name,
    );
    expect(names).toContain("a.ts");
    expect(names).toContain("components/ui");
    expect(src.children.some((c) => c.kind === "dir" && c.path === "src/components")).toBe(
      false,
    );
  });

  it("counts files recursively on directories", () => {
    const roots = buildPathTree([
      { segments: ["src", "a.ts"], path: "src/a.ts", data: { id: "a" } },
      { segments: ["src", "b.ts"], path: "src/b.ts", data: { id: "b" } },
      { segments: ["lib", "c.ts"], path: "lib/c.ts", data: { id: "c" } },
    ]);
    expect(dir(roots[0]).fileCount).toBe(2);
    expect(dir(roots[1]).fileCount).toBe(1);
  });

  it("places root-level files without a parent directory", () => {
    const roots = buildPathTree([
      { segments: ["README.md"], path: "README.md", data: { id: "r" } },
    ]);
    expect(roots).toHaveLength(1);
    expect(leaf(roots[0]).name).toBe("README.md");
  });
});
