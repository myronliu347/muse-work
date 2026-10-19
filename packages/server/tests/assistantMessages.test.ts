import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";
import { recordPopoMasterInbound } from "../src/services/assistant/popoTranscript.js";

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
    log.append("user", "私聊", undefined, "popo");
    const page = log.page();
    expect(page.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(page.messages[0]).toMatchObject({ id: "id-1", message: "你好" });
    expect(page.messages[0]?.app).toBeUndefined();
    expect(page.messages[2]).toMatchObject({ message: "私聊", app: "popo" });
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

  it("returns the newest page without reading older slices", () => {
    const dirHome = home();
    const dir = path.join(getMuseHomeDir(dirHome), "db", "assistant-messages");
    fs.mkdirSync(dir, { recursive: true });
    const line = (id: string) =>
      JSON.stringify({ id, at: 1, role: "user", message: id });
    fs.writeFileSync(
      path.join(dir, "000001.jsonl"),
      `${Array.from({ length: 10 }, (_, i) => line(`old-${i}`)).join("\n")}\n`,
    );
    fs.writeFileSync(
      path.join(dir, "000002.jsonl"),
      `${Array.from({ length: 60 }, (_, i) => line(`new-${i}`)).join("\n")}\n`,
    );
    const log = createAssistantMessageLog({ home: dirHome });
    const readFileSync = vi.spyOn(fs, "readFileSync");
    const page = log.page();
    const paths = readFileSync.mock.calls.map((call) => String(call[0]));
    readFileSync.mockRestore();
    expect(paths.some((filePath) => filePath.endsWith("000001.jsonl"))).toBe(false);
    expect(paths.some((filePath) => filePath.endsWith("000002.jsonl"))).toBe(true);
    expect(page.messages.map((item) => item.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => `new-${i + 10}`),
    );
    expect(page.hasMore).toBe(true);

    const older = log.page({ before: "new-10" });
    expect(older.messages.map((item) => item.id)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `old-${i}`),
      ...Array.from({ length: 10 }, (_, i) => `new-${i}`),
    ]);
    expect(older.hasMore).toBe(false);
    expect(log.page({ before: "missing" }).messages).toEqual([]);
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

  it("records the master's POPO private message and skips groups", () => {
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1,
      newId: () => "popo",
    });
    const broadcasts: unknown[] = [];
    const hub = { broadcastAll: (event: unknown) => broadcasts.push(event) };
    recordPopoMasterInbound(log, hub, { from: "popo", message: "  在吗  " });
    recordPopoMasterInbound(log, hub, { from: "popo-group", message: "群里" });
    recordPopoMasterInbound(log, hub, { from: "popo", message: "   " });
    expect(log.page().messages).toEqual([
      expect.objectContaining({ role: "user", message: "  在吗  ", app: "popo" }),
    ]);
    expect(broadcasts).toHaveLength(1);
  });
});
