/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  displayFilePath,
  middleEllipsis,
} from "../../src/utils/filePathDisplay";

describe("displayFilePath", () => {
  it("uses relative path under workdir", () => {
    expect(displayFilePath("/a/b/c.ts", "/a/b")).toBe("c.ts");
    expect(displayFilePath("/a/b/src/x.ts", "/a/b")).toBe("src/x.ts");
  });

  it("uses absolute when outside workdir", () => {
    expect(displayFilePath("/other/x.ts", "/a/b")).toBe("/other/x.ts");
  });
});

describe("middleEllipsis", () => {
  it("keeps short paths intact", () => {
    expect(middleEllipsis("src/a.ts")).toBe("src/a.ts");
  });
});
