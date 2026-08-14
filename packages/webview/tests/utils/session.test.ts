import type { Message, SessionMetadata } from "wave-agent-sdk";
import { getSessionTitle } from "../../src/utils/session";

function session(
  overrides: Partial<SessionMetadata> & { title?: string } = {},
): SessionMetadata {
  return {
    id: "s1",
    sessionType: "main",
    workdir: "/w",
    createdAt: new Date(0),
    lastActiveAt: new Date(0),
    latestTotalTokens: 0,
    ...overrides,
  };
}

function userMessage(text: string): Message {
  return {
    id: "u1",
    role: "user",
    timestamp: "0",
    blocks: [{ type: "text", content: text }],
  };
}

describe("getSessionTitle", () => {
  it("prefers the renamed session title over the first user message", () => {
    expect(
      getSessionTitle(session({ title: "markdown bug 修复" }), [
        userMessage("hi"),
      ]),
    ).toBe("markdown bug 修复");
  });

  it("prefers the renamed session title over a pinned firstMessage", () => {
    expect(
      getSessionTitle(
        session({ title: "markdown bug 修复", firstMessage: "hi" }),
      ),
    ).toBe("markdown bug 修复");
  });

  it("falls back to the first user message while title is still 新对话", () => {
    expect(
      getSessionTitle(session({ title: "新对话" }), [userMessage("hi")]),
    ).toBe("hi");
  });

  it("shows 新对话 when there is no session", () => {
    expect(getSessionTitle(undefined)).toBe("新对话");
  });
});
