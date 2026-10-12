import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionStore } from "../src/services/sessionStore.js";
import {
  defaultScenarioModels,
  saveScenarioModelsFile,
} from "../src/services/agentConfig.js";
import { ASSISTANT_TOOLS, ensureAssistantSession } from "../src/services/assistant/session.js";

describe("ensureAssistantSession", () => {
  it("creates one assistant session and reuses it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-sess-"));
    const store = createSessionStore({ home });
    const first = ensureAssistantSession(store, { home });
    expect(first.model).toBe(defaultScenarioModels().assistant);
    const second = ensureAssistantSession(store, { home });
    expect(second.id).toBe(first.id);
    expect(first.origin).toBe("assistant");
    expect(first.workdir).toBe(path.join(home, "assistant-chat"));
    expect(first.permissionMode).toBe("bypassPermissions");
    expect(first.tools).toEqual([...ASSISTANT_TOOLS]);
    expect(first.disallowedTools).toBeUndefined();
    expect(store.list().filter((s) => s.origin === "assistant")).toHaveLength(1);
    expect(store.listGrouped().recent.map((s) => s.id)).not.toContain(first.id);
    expect(first.systemPrompt).toContain("短回复必须用 `SendMessage`");
    expect(first.systemPrompt).toContain("按先后处理每一段");
    expect(first.systemPrompt).toContain("必须把 `worktree` 设为 true");
    expect(first.systemPrompt).toContain("当前这一步结束后进入同一轮");
    expect(first.systemPrompt).not.toContain("interrupt");
    expect(first.systemPrompt).toContain("主人跟机器人的私聊");
    expect(first.systemPrompt).toContain("干活的是 Issue 会话");
    expect(first.systemPrompt).toContain("`Agent` 只做跟项目无关的杂事");
    expect(first.systemPrompt).toContain("谁在哪个频道问");
    expect(first.systemPrompt).toContain("每条发给人的话都要温和可爱");
    expect(first.systemPrompt).toContain("把标准念出来算失败");
    expect(first.systemPrompt).toContain("派活前先弄清这件事要做什么");
    expect(first.systemPrompt).toContain("同一件事只开一条 Issue");
    expect(first.systemPrompt).toContain("不要为下一步再 `CreateIssue`");
    expect(first.systemPrompt).not.toContain("讲清缺陷");
    expect(first.systemPrompt).toContain("只写查数据和出报告");
    expect(first.systemPrompt).toContain("instruction");
    expect(first.systemPrompt).toContain("--remind");
    expect(first.systemPrompt).toContain("WebSearch");
    expect(first.systemPrompt).toContain("WebFetch");
    expect(first.systemPrompt).not.toContain("线上");
    store.update(first.id, {
      systemPrompt: "旧提示",
      tools: ["ListIssues"],
      disallowedTools: ["Bash"],
    });
    const refreshed = ensureAssistantSession(store, { home });
    expect(refreshed.model).toBe(defaultScenarioModels().assistant);
    saveScenarioModelsFile({ version: 1, models: { assistant: "bot-model" } }, home);
    const switched = ensureAssistantSession(store, { home });
    expect(switched.id).toBe(first.id);
    expect(switched.model).toBe("bot-model");
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.systemPrompt).toContain("短回复必须用 `SendMessage`");
    expect(refreshed.tools).toEqual([...ASSISTANT_TOOLS]);
    expect(refreshed.disallowedTools).toBeUndefined();
  });
});
