import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
) as {
  build?: {
    extraResources?: Array<{ from?: string; to?: string }>;
  };
};

describe("electron-builder extraResources", () => {
  it("copies muse-server node_modules as a top-level extraResource", () => {
    // electron-builder's FileMatcher skips a directory named `node_modules`
    // when it is nested under another extraResources `from`. The server tree
    // must be copied in two FileSets so winston / @muse-work/agent ship in the app.
    const extras = pkg.build?.extraResources ?? [];
    expect(extras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "dist/muse-server/node_modules",
          to: "muse-server/node_modules",
        }),
        expect.objectContaining({
          from: "dist/bundled-hot.json",
          to: "bundled-hot.json",
        }),
      ]),
    );
  });
});
