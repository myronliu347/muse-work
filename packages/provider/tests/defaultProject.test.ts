import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultProjectWorkdir } from "../src/defaultProject.js";

describe("createDefaultProjectWorkdir", () => {
  it("creates ~/.muse-work/projects/YYYYMMDD-uid under home", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-home-"));
    const dir = createDefaultProjectWorkdir(home);
    expect(dir.startsWith(path.join(home, ".muse-work", "projects"))).toBe(
      true,
    );
    expect(path.basename(dir)).toMatch(/^\d{8}-[a-f0-9]{8}$/);
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
