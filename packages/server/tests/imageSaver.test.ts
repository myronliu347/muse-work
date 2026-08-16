import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  saveBase64Images,
  appendImageSourceMarkers,
  resolveUploadsDir,
} from "../src/utils/imageSaver.js";

describe("imageSaver", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  describe("resolveUploadsDir", () => {
    it("resolves under os.tmpdir()/muse-work/uploads", () => {
      expect(resolveUploadsDir()).toBe(
        path.join(os.tmpdir(), "muse-work", "uploads"),
      );
    });
  });

  describe("saveBase64Images", () => {
    it("writes base64 image data to the uploads dir and returns paths", async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-saver-"));
      const dir = path.join(tmp, "uploads");
      const png =
        "data:image/png;base64," +
        Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

      const paths = await saveBase64Images(
        [{ data: png, mediaType: "image/png" }],
        dir,
      );

      expect(paths).toHaveLength(1);
      expect(paths[0]).toMatch(/\.png$/);
      expect(paths[0].startsWith(dir)).toBe(true);
      expect(fs.existsSync(paths[0])).toBe(true);
      expect(fs.readFileSync(paths[0])).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      );
    });

    it("derives extension from mediaType", async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-saver-"));
      const dir = path.join(tmp, "uploads");
      const jpeg =
        "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8]).toString("base64");

      const paths = await saveBase64Images(
        [{ data: jpeg, mediaType: "image/jpeg" }],
        dir,
      );

      expect(paths[0]).toMatch(/\.jpeg$/);
    });

    it("creates the uploads dir when missing", async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-saver-"));
      const dir = path.join(tmp, "nested", "uploads");

      const paths = await saveBase64Images(
        [{ data: "data:image/png;base64,AA==", mediaType: "image/png" }],
        dir,
      );

      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.existsSync(paths[0])).toBe(true);
    });

    it("uses distinct filenames for multiple images", async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-saver-"));
      const dir = path.join(tmp, "uploads");

      const paths = await saveBase64Images(
        [
          { data: "data:image/png;base64,AA==", mediaType: "image/png" },
          { data: "data:image/png;base64,AA==", mediaType: "image/png" },
        ],
        dir,
      );

      expect(paths).toHaveLength(2);
      expect(new Set(paths).size).toBe(2);
    });

    it("returns empty array for no images", async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-saver-"));
      expect(await saveBase64Images([], tmp)).toEqual([]);
    });
  });

  describe("appendImageSourceMarkers", () => {
    it("appends a single marker after the content", () => {
      expect(
        appendImageSourceMarkers("hello", ["/tmp/muse-work/uploads/a.png"]),
      ).toBe("hello\n\n[Image source: /tmp/muse-work/uploads/a.png]");
    });

    it("appends one marker per image on separate lines", () => {
      expect(
        appendImageSourceMarkers("look", [
          "/tmp/muse-work/uploads/a.png",
          "/tmp/muse-work/uploads/b.jpg",
        ]),
      ).toBe(
        "look\n\n" +
          "[Image source: /tmp/muse-work/uploads/a.png]\n" +
          "[Image source: /tmp/muse-work/uploads/b.jpg]",
      );
    });

    it("returns content unchanged when no images", () => {
      expect(appendImageSourceMarkers("hello", [])).toBe("hello");
    });

    it("returns only markers when content is empty", () => {
      expect(appendImageSourceMarkers("", ["/tmp/a.png"])).toBe(
        "[Image source: /tmp/a.png]",
      );
    });
  });
});
