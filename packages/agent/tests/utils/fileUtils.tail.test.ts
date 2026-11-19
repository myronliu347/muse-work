import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTailLinesUntil } from "../../src/utils/fileUtils.js";

describe("readTailLinesUntil", () => {
  it("returns the newest lines and reports older data", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-tail-"));
    const file = path.join(dir, "rows.jsonl");
    fs.writeFileSync(
      file,
      Array.from({ length: 100 }, (_, index) => `line-${index + 1}`).join("\n") +
        "\n",
    );

    const { lines, hasOlder } = await readTailLinesUntil(file, 5, {
      startBytes: 32,
    });
    expect(lines).toEqual(["line-96", "line-97", "line-98", "line-99", "line-100"]);
    expect(hasOlder).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("hasOlder is false when the whole file fits", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-tail-"));
    const file = path.join(dir, "rows.jsonl");
    fs.writeFileSync(file, "a\nb\nc\n");

    const { lines, hasOlder } = await readTailLinesUntil(file, 10);
    expect(lines).toEqual(["a", "b", "c"]);
    expect(hasOlder).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
