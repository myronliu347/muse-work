import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@muse-work/agent";
import { defaultCreateAgent } from "../src/services/sessionRunner/ctx.js";

describe("defaultCreateAgent message snapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getMessages returns the UI transcript, including messages before the compact boundary", async () => {
    const context = [{ id: "compact" }];
    const display = [{ id: "user-before" }, { id: "assistant-before" }, { id: "compact" }];
    vi.spyOn(Agent, "create").mockResolvedValue({
      messages: context,
      displayMessages: display,
      sessionId: "s1",
      getPermissionMode: () => "acceptEdits",
    } as unknown as Agent);

    const wrapped = await defaultCreateAgent({
      workdir: "/tmp/muse-display-messages",
      model: "test-model",
    });

    expect(wrapped.getMessages?.()).toEqual(display);
    expect(wrapped.getMessages?.()).not.toBe(context);
  });
});
