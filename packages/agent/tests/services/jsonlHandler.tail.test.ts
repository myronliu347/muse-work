import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonlHandler } from "../../src/services/jsonlHandler.js";

function line(index: number): string {
  return JSON.stringify({
    id: `m${index}`,
    role: "assistant",
    blocks: [{ type: "text", content: `reply ${index}` }],
    timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  });
}

describe("JsonlHandler.readTailMessages", () => {
  it("parses only the newest lines and skips reserved entries", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-jsonl-tail-"));
    const file = path.join(dir, "session.jsonl");
    const rows = [
      JSON.stringify({ type: "metadata", workdir: "/tmp" }),
      ...Array.from({ length: 50 }, (_, index) => line(index)),
      JSON.stringify({ type: "custom-title", customTitle: "标题" }),
    ];
    fs.writeFileSync(file, `${rows.join("\n")}\n`);

    const page = await new JsonlHandler().readTailMessages(file, 10);
    expect(page.messages.map((message) => message.id)).toEqual([
      "m40",
      "m41",
      "m42",
      "m43",
      "m44",
      "m45",
      "m46",
      "m47",
      "m48",
      "m49",
    ]);
    expect(page.hasOlder).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
