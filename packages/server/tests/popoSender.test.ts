import { describe, expect, it } from "vitest";
import {
  chunkText,
  createSender,
  type Sender,
} from "../src/popo/sender.js";

describe("popo sender", () => {
  it("chunkText splits long content at 3000 code points", () => {
    const content = "a".repeat(6000) + "😀";
    const chunks = chunkText(content);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(3000);
    expect(chunks[2]).toBe("😀");
  });

  it("sendText posts with Open-Access-Token and returns on errcode 0", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()) as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
    }) as typeof fetch;

    const sender: Sender = createSender({
      tokenStore: { getAccessToken: async () => "tk-1", forceRefresh: async () => "tk-2" },
      fetchImpl,
    });
    await sender.sendText("user@corp.netease.com", "hello");
    expect(seen[0].headers["open-access-token"]).toBe("tk-1");
    expect(seen[0].body).toEqual({
      receiver: "user@corp.netease.com",
      message: { content: "hello" },
      msgType: "text",
    });
  });

  it("retries once with a fresh token on 42001", async () => {
    const tokens: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      tokens.push(headers.get("open-access-token") ?? "");
      const first = tokens.length === 1;
      return new Response(
        JSON.stringify(
          first
            ? { errcode: 42001, errmsg: "access token expired" }
            : { errcode: 0, errmsg: "ok" },
        ),
        { status: 200 },
      );
    }) as typeof fetch;

    const sender: Sender = createSender({
      tokenStore: { getAccessToken: async () => "stale", forceRefresh: async () => "fresh" },
      fetchImpl,
    });
    await sender.sendText("g1", "hi");
    expect(tokens).toEqual(["stale", "fresh"]);
  });

  it("throws on non-zero errcode", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ errcode: 65338, errmsg: "too long" }), { status: 200 })) as typeof fetch;
    const sender: Sender = createSender({
      tokenStore: { getAccessToken: async () => "tk", forceRefresh: async () => "tk" },
      fetchImpl,
    });
    await expect(sender.sendText("r", "x")).rejects.toThrow(/65338/);
  });
});
