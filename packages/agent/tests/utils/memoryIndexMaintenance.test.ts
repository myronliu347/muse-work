import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureArchivePointer,
  ensureMemoryIndexEntry,
  isDerivedIndexFile,
  rejectDerivedIndexWrite,
} from "@/utils/memoryIndexMaintenance.js";
import { scanMemoryFiles } from "@/utils/memoryIndex.js";
import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
} from "@/constants/memory.js";

async function memoryDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "muse-memory-"));
}

function topicFile(name: string): string {
  return `---\nname: ${name}\ndescription: about ${name}\ntype: feedback\n---\n\n- a rule\n`;
}

describe("memoryIndexMaintenance", () => {
  it("adds a missing pointer and stays idempotent", async () => {
    const dir = await memoryDir();
    await fs.writeFile(
      path.join(dir, "MEMORY.md"),
      "# Memory\n\n- [existing](existing.md) — existing\n",
    );
    await fs.writeFile(path.join(dir, "new_rule.md"), topicFile("New rule"));

    const note = await ensureMemoryIndexEntry(
      path.join(dir, "new_rule.md"),
      dir,
    );
    expect(note).toContain("new_rule.md");
    const index = await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8");
    expect(index).toContain("[New rule](new_rule.md) — about New rule");

    const again = await ensureMemoryIndexEntry(
      path.join(dir, "new_rule.md"),
      dir,
    );
    expect(again).toBeNull();
  });

  it("puts a new pointer in its type section, not under 归档", async () => {
    const dir = await memoryDir();
    await fs.writeFile(
      path.join(dir, "MEMORY.md"),
      [
        "# Memory",
        "",
        "## Feedback",
        "- [old rule](old.md) — old",
        "",
        "## 归档",
        "- [归档：1 个低优先级文件](archive.md) — 旧记录",
        "",
      ].join("\n"),
    );
    await fs.writeFile(path.join(dir, "archive.md"), "# Archive\n");
    await fs.writeFile(path.join(dir, "new_rule.md"), topicFile("New rule"));

    await ensureMemoryIndexEntry(path.join(dir, "new_rule.md"), dir);
    const lines = (await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const newRuleAt = lines.findIndex((line) => line.includes("new_rule.md"));
    const archiveAt = lines.findIndex((line) => line === "## 归档");
    expect(newRuleAt).toBeGreaterThan(-1);
    expect(archiveAt).toBeGreaterThan(newRuleAt);
  });

  it("does not duplicate a pointer that lives in an archive page", async () => {
    const dir = await memoryDir();
    await fs.writeFile(
      path.join(dir, "MEMORY.md"),
      "# Memory\n\n- [archive](archive.md) — old\n",
    );
    await fs.writeFile(
      path.join(dir, "archive.md"),
      "---\nname: archive\ndescription: old\ntype: reference\n---\n\n- [Old](old.md) — old\n",
    );
    await fs.writeFile(path.join(dir, "old.md"), topicFile("Old"));

    expect(
      await ensureMemoryIndexEntry(path.join(dir, "old.md"), dir),
    ).toBeNull();
  });

  it("refuses to append when the entrypoint is full", async () => {
    const dir = await memoryDir();
    await fs.writeFile(
      path.join(dir, "MEMORY.md"),
      Array.from(
        { length: MAX_MEMORY_ENTRYPOINT_LINES + 1 },
        (_, i) => `- [e${i}](e${i}.md)`,
      ).join("\n"),
    );
    await fs.writeFile(path.join(dir, "late.md"), topicFile("Late"));

    const note = await ensureMemoryIndexEntry(path.join(dir, "late.md"), dir);
    expect(note).toContain("MEMORY.md is full");
    expect(note).toContain("archive.md");
    expect(note).toContain("least recently used");
    const index = await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8");
    expect(index).not.toContain("late.md");
  });

  it("never indexes itself or generated index pages", async () => {
    const dir = await memoryDir();
    await fs.writeFile(path.join(dir, "MEMORY.md"), "# Memory\n");
    await fs.writeFile(path.join(dir, "archive.md"), "# Archive\n");
    for (const file of ["MEMORY.md", "archive.md", "index_feedback.md"]) {
      expect(
        await ensureMemoryIndexEntry(path.join(dir, file), dir),
      ).toBeNull();
    }
  });

  it("rejects writes to derived pages but allows topic files", async () => {
    const dir = await memoryDir();
    expect(rejectDerivedIndexWrite(path.join(dir, "archive.md"), dir)).toContain(
      "generated index page",
    );
    expect(
      rejectDerivedIndexWrite(path.join(dir, "index_feedback.md"), dir),
    ).toContain("generated index page");
    expect(rejectDerivedIndexWrite(path.join(dir, "a.md"), dir)).toBeNull();
    expect(isDerivedIndexFile("archive_2.md")).toBe(true);
    expect(isDerivedIndexFile("feedback_review.md")).toBe(false);
  });

  it("restores a dropped archive pointer", async () => {
    const dir = await memoryDir();
    await fs.writeFile(path.join(dir, "MEMORY.md"), "# Memory\n");
    await fs.writeFile(path.join(dir, "archive.md"), "# Archive\n");

    const note = await ensureArchivePointer(dir);
    expect(note).toContain("Restored");
    const index = await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8");
    expect(index).toContain("](archive.md)");
    expect(await ensureArchivePointer(dir)).toBeNull();
  });

  it("keeps derived pages out of the memory manifest", async () => {
    const dir = await memoryDir();
    await fs.writeFile(path.join(dir, "MEMORY.md"), "# Memory\n");
    await fs.writeFile(path.join(dir, "archive.md"), "# Archive\n");
    await fs.writeFile(path.join(dir, "index_feedback.md"), "# Hub\n");
    await fs.writeFile(path.join(dir, "a.md"), topicFile("A"));

    const files = (await scanMemoryFiles(dir)).map((header) => header.filename);
    expect(files).toEqual(["a.md"]);
  });
});
