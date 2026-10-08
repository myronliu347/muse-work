import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";

function home() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-msg-"));
}

describe("assistant message log", () => {
  it("appends user then assistant lines and pages newest 50 oldest-first", () => {
    let n = 0;
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1_700_000_000_000 + n,
      newId: () => `id-${++n}`,
    });
    log.append("user", "你好");
    log.append("assistant", "在");
    const page = log.page();
    expect(page.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(page.messages[0]).toMatchObject({ id: "id-1", message: "你好" });
    expect(page.hasMore).toBe(false);
  });

  it("rotates when the current slice is already 1 MiB", () => {
    const dirHome = home();
    const log = createAssistantMessageLog({
      home: dirHome,
      now: () => 1,
      newId: () => "a",
    });
    log.append("user", "x".repeat(1_048_576));
    log.append("assistant", "next");
    const dir = path.join(getMuseHomeDir(dirHome), "db", "assistant-messages");
    expect(fs.readdirSync(dir).sort()).toEqual(["000001.jsonl", "000002.jsonl"]);
    const second = fs.readFileSync(path.join(dir, "000002.jsonl"), "utf8");
    expect(second).toContain("next");
  });

  it("pages older rows across slices with before", () => {
    let n = 0;
    const log = createAssistantMessageLog({
      home: home(),
      now: () => ++n,
      newId: () => `id-${n}`,
    });
    for (let i = 0; i < 3; i++) log.append("user", `m${i}`);
    const page = log.page({ before: "id-3", limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual(["id-1", "id-2"]);
    expect(page.hasMore).toBe(false);
  });

  it("search returns a matching line from the newest slice", () => {
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1,
      newId: () => "only",
    });
    log.append("user", "find-me " + "z".repeat(200));
    const found = log.search({ q: "find-me", limit: 50 });
    expect(found.messages).toHaveLength(1);
    expect(found.truncatedScan).toBeUndefined();
  });

  it("truncates tool-facing message at 8000 code points", () => {
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1,
      newId: () => "long",
    });
    log.append("assistant", "你".repeat(8001));
    const found = log.search({ q: "你", limit: 1 });
    expect([...found.messages[0].message].length).toBe(8000);
    expect(found.messages[0].truncated).toBe(true);
  });

  it("keeps images on the stored line", () => {
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1,
      newId: () => "img",
    });
    const line = log.append("user", "[image1]", [
      { data: "data:image/png;base64,a", mediaType: "image/png" },
    ]);
    expect(line.images).toEqual([
      { data: "data:image/png;base64,a", mediaType: "image/png" },
    ]);
    expect(log.page().messages[0].images).toEqual(line.images);
  });
});
