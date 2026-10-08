import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionStore } from "../src/services/sessionStore.js";
import {
  ASSISTANT_TOOL_NAMES,
  ensureAssistantSession,
} from "../src/services/assistant/session.js";

describe("ensureAssistantSession", () => {
  it("creates one assistant session and reuses it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-sess-"));
    const store = createSessionStore({ home });
    const first = ensureAssistantSession(store, { home, model: "m" });
    const second = ensureAssistantSession(store, { home, model: "m" });
    expect(second.id).toBe(first.id);
    expect(first.origin).toBe("assistant");
    expect(first.workdir).toBe(path.join(home, "assistant-chat"));
    expect(first.permissionMode).toBe("bypassPermissions");
    expect(first.tools).toEqual([...ASSISTANT_TOOL_NAMES]);
    expect(store.list().filter((s) => s.origin === "assistant")).toHaveLength(1);
    expect(store.listGrouped().recent.map((s) => s.id)).not.toContain(first.id);
    expect(first.systemPrompt).toContain("短回复必须用 `SendMessage`");
    store.update(first.id, { systemPrompt: "旧提示", tools: ["ListIssues"] });
    const refreshed = ensureAssistantSession(store, { home, model: "m" });
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.systemPrompt).toContain("短回复必须用 `SendMessage`");
    expect(refreshed.tools).toEqual([...ASSISTANT_TOOL_NAMES]);
  });
});
