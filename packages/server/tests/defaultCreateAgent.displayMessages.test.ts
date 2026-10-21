import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@muse-work/agent";
import { defaultCreateAgent } from "../src/services/sessionRunner/ctx.js";

describe("defaultCreateAgent message snapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getMessages returns the folded API context", async () => {
    const context = [{ id: "compact" }, { id: "user-after" }];
    vi.spyOn(Agent, "create").mockResolvedValue({
      messages: context,
      sessionId: "s1",
      getPermissionMode: () => "acceptEdits",
    } as unknown as Agent);

    const wrapped = await defaultCreateAgent({
      workdir: "/tmp/muse-display-messages",
      model: "test-model",
    });

    expect(wrapped.getMessages?.()).toEqual(context);
  });
});
