import { describe, it, expect } from "vitest";
import path from "path";
import { resolveWorkdirKey } from "../../src/shared/pathKey.js";

describe("resolveWorkdirKey", () => {
  it("resolves relative workdir to absolute", () => {
    const key = resolveWorkdirKey("./foo");
    expect(key).toBe(path.resolve("./foo"));
  });
});
