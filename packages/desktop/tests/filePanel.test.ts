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

  it("marks files larger than 2MB as too-large", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-file-"));
    const file = path.join(dir, "big.txt");
    fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
    const view = await readLocalFileForPanel(file);
    expect(view.unsupported).toBe("too-large");
    expect(view.content).toBeUndefined();
    expect(view.sizeBytes).toBe(2 * 1024 * 1024 + 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks binary files as binary", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-file-"));
    const file = path.join(dir, "blob.bin");
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3, 0, 4]));
    const view = await readLocalFileForPanel(file);
    expect(view.unsupported).toBe("binary");
    expect(view.content).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects oversized images", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-file-"));
    const file = path.join(dir, "big.png");
    const buf = Buffer.alloc(2 * 1024 * 1024 + 10, 0);
    buf.write("\x89PNG\r\n\x1a\n", 0);
    fs.writeFileSync(file, buf);
    const view = await readLocalFileForPanel(file);
    expect(view.unsupported).toBe("too-large");
    expect(view.imageBase64).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("readLocalFileForPanel markdown images", () => {
  it("embeds workdir-relative images as data URIs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-md-"));
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs", "img.png"), Buffer.from([1, 2, 3]));
    const file = path.join(dir, "README.md");
    fs.writeFileSync(
      file,
      "# Hi\n\n![shot](docs/img.png)\n\n<img src=\"docs/img.png\" alt=\"x\">\n",
      "utf8",
    );
    const view = await readLocalFileForPanel(file, { workdir: dir });
    expect(view.error).toBeUndefined();
    expect(view.content).toContain("![shot](data:image/png;base64,AQID)");
    expect(view.content).toContain('<img src="data:image/png;base64,AQID"');
    expect(view.content).not.toContain("docs/img.png");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves remote URLs, absolute paths, and missing files untouched", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-md-"));
    const file = path.join(dir, "README.md");
    fs.writeFileSync(
      file,
      "![remote](https://example.com/a.png)\n![abs](/etc/hosts)\n![missing](nope.png)\n",
      "utf8",
    );
    const view = await readLocalFileForPanel(file, { workdir: dir });
    expect(view.content).toBe(
      "![remote](https://example.com/a.png)\n![abs](/etc/hosts)\n![missing](nope.png)\n",
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not rewrite non-markdown files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-md-"));
    fs.writeFileSync(path.join(dir, "img.png"), Buffer.from([1, 2, 3]));
    const file = path.join(dir, "notes.txt");
    fs.writeFileSync(file, "![shot](img.png)\n", "utf8");
    const view = await readLocalFileForPanel(file, { workdir: dir });
    expect(view.content).toBe("![shot](img.png)\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves images alone when no workdir is provided", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-md-"));
    fs.writeFileSync(path.join(dir, "img.png"), Buffer.from([1, 2, 3]));
    const file = path.join(dir, "README.md");
    fs.writeFileSync(file, "![shot](img.png)\n", "utf8");
    const view = await readLocalFileForPanel(file);
    expect(view.content).toBe("![shot](img.png)\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
