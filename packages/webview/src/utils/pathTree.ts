/** Shared path → directory tree builder for Diff / content-search sidebars. */

export type PathTreeLeaf<T> = {
  kind: "file";
  name: string;
  /** Stable id for the leaf (often the original absolute/relative file path). */
  path: string;
  data: T;
};

export type PathTreeDir<T> = {
  kind: "dir";
  name: string;
  /** Directory key used for collapse state (e.g. "src/components"). */
  path: string;
  children: PathTreeNode<T>[];
  fileCount: number;
};

export type PathTreeNode<T> = PathTreeLeaf<T> | PathTreeDir<T>;

export type PathTreeInput<T> = {
  /** Non-empty path segments leading to the file (last = file name). */
  segments: string[];
  /** Leaf path identity preserved on the file node. */
  path: string;
  data: T;
};

const SEP = "/";

/** Collapse single-child directory chains: a → b → c → file becomes "a/b/c". */
function compressTree<T>(nodes: PathTreeNode<T>[]): PathTreeNode<T>[] {
  const out: PathTreeNode<T>[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      out.push(node);
      continue;
    }
    const children = compressTree(node.children);
    if (children.length === 1 && children[0].kind === "dir") {
      const child = children[0];
      out.push({
        kind: "dir",
        name: `${node.name}${SEP}${child.name}`,
        path: child.path,
        children: child.children,
        fileCount: child.fileCount,
      });
    } else {
      out.push({ ...node, children });
    }
  }
  return out;
}

function countFiles<T>(node: PathTreeDir<T>): number {
  node.fileCount = node.children.reduce(
    (n, c) => n + (c.kind === "file" ? 1 : countFiles(c)),
    0,
  );
  return node.fileCount;
}

/**
 * Build a directory tree from flat path entries. Only directories touched by
 * the inputs are created. Single-child dir chains are merged.
 */
export function buildPathTree<T>(items: PathTreeInput<T>[]): PathTreeNode<T>[] {
  const root: PathTreeDir<T> = {
    kind: "dir",
    name: "",
    path: "",
    children: [],
    fileCount: 0,
  };

  for (const item of items) {
    const segments = item.segments.filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    let node = root;
    let dirPath = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const part = segments[i];
      dirPath = dirPath ? `${dirPath}${SEP}${part}` : part;
      let child = node.children.find(
        (c): c is PathTreeDir<T> => c.kind === "dir" && c.path === dirPath,
      );
      if (!child) {
        child = {
          kind: "dir",
          name: part,
          path: dirPath,
          children: [],
          fileCount: 0,
        };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({
      kind: "file",
      name: segments[segments.length - 1],
      path: item.path,
      data: item.data,
    });
  }

  countFiles(root);
  return compressTree(root.children);
}

/** Split a path into non-empty segments (normalizes `\\` to `/`). */
export function pathSegments(path: string): string[] {
  return path
    .replace(/\\/g, SEP)
    .split(SEP)
    .filter((s) => s.length > 0);
}
