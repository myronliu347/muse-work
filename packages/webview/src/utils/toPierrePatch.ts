import { parsePatchFiles } from "@pierre/diffs";

export type PierrePatchInput = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string;
  hunks: string;
  binary: boolean;
};

/** Build a unified patch string for `@pierre/diffs` from DiffPane file data. */
export function toPierrePatch(file: PierrePatchInput): string | null {
  if (file.binary || !file.hunks.trim()) return null;

  if (file.status === "untracked" && !file.hunks.includes("@@")) {
    const lines = file.hunks.split("\n").filter((l) => l.startsWith("+"));
    const n = lines.length;
    return [
      "--- /dev/null",
      `+++ b/${file.path}`,
      `@@ -0,0 +1,${n} @@`,
      ...lines,
    ].join("\n");
  }

  const oldPath =
    file.status === "added" ? "/dev/null" : `a/${file.oldPath ?? file.path}`;
  const newPath =
    file.status === "deleted" ? "/dev/null" : `b/${file.path}`;
  const oldHeader =
    oldPath === "/dev/null" ? "--- /dev/null" : `--- ${oldPath}`;
  const newHeader =
    newPath === "/dev/null" ? "+++ /dev/null" : `+++ ${newPath}`;
  return `${oldHeader}\n${newHeader}\n${file.hunks}`;
}

/** Resolve line text from a patch using Pierre's 1-based side line numbers. */
export function resolveDiffLineText(
  patch: string,
  side: "additions" | "deletions",
  lineNumber: number,
): string {
  const meta = parsePatchFiles(patch)[0]?.files[0];
  if (!meta) return "";
  for (const hunk of meta.hunks) {
    if (side === "additions") {
      const start = hunk.additionStart;
      const count = hunk.additionCount;
      if (lineNumber >= start && lineNumber < start + count) {
        const idx = hunk.additionLineIndex + (lineNumber - start);
        return (meta.additionLines[idx] ?? "").replace(/\n$/, "");
      }
    } else {
      const start = hunk.deletionStart;
      const count = hunk.deletionCount;
      if (lineNumber >= start && lineNumber < start + count) {
        const idx = hunk.deletionLineIndex + (lineNumber - start);
        return (meta.deletionLines[idx] ?? "").replace(/\n$/, "");
      }
    }
  }
  return "";
}
