import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLocalFileForPanel } from "../src/main/filePanel.js";

describe("readLocalFileForPanel", () => {
  it("reads a text file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-file-"));
    const file = path.join(dir, "hello.json");
    fs.writeFileSync(file, '{"ok":true}\n', "utf8");
    const view = await readLocalFileForPanel(file, { startLine: 1, endLine: 1 });
    expect(view.error).toBeUndefined();
    expect(view.content).toContain('"ok":true');
    expect(view.startLine).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports missing files", async () => {
    const view = await readLocalFileForPanel("/tmp/muse-does-not-exist-xyz");
    expect(view.error).toMatch(/不存在/);
  });
});
