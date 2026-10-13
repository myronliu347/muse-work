import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

  it("uploads a local image then sends it with fileKey", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popo-file-"));
    const filePath = path.join(dir, "shot.png");
    const bytes = Buffer.from("png-bytes");
    fs.writeFileSync(filePath, bytes);
    const seen: Array<{ url: string; method: string; body: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const raw = init?.body;
      seen.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: typeof raw === "string" ? raw : Buffer.from(raw as Uint8Array).toString(),
      });
      if (String(url).endsWith("/im/file")) {
        return new Response(JSON.stringify({
          errcode: 0,
          data: { fileKey: "fk-1", uploadUrl: "https://upload.example/p" },
        }), { status: 200 });
      }
      if (String(url) === "https://upload.example/p") {
        return new Response(null, { status: 200 });
      }
      return new Response(JSON.stringify({ errcode: 0, data: { msgId: "img-1" } }), { status: 200 });
    }) as typeof fetch;
    const sender = createSender({
      tokenStore: { getAccessToken: async () => "tk", forceRefresh: async () => "tk" },
      fetchImpl,
    });
    await expect(sender.sendLocalFile("user@corp.netease.com", filePath)).resolves.toBe("img-1");
    expect(JSON.parse(seen[0].body)).toEqual({
      fileType: "png",
      fileName: "shot.png",
      fileMd5: crypto.createHash("md5").update(bytes).digest("hex"),
    });
    expect(seen[1]).toMatchObject({ url: "https://upload.example/p", method: "PUT", body: "png-bytes" });
    expect(JSON.parse(seen[2].body)).toEqual({
      receiver: "user@corp.netease.com",
      message: { fileKey: "fk-1" },
      msgType: "image",
    });
  });

  it("sends other local files as file messages", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popo-doc-"));
    const filePath = path.join(dir, "note.txt");
    fs.writeFileSync(filePath, "hello");
    const bodies: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
      if (String(url).endsWith("/im/file")) {
        return new Response(JSON.stringify({
          errcode: 0,
          data: { fileKey: "fk-2", uploadUrl: "https://upload.example/f" },
        }), { status: 200 });
      }
      if (String(url) === "https://upload.example/f") return new Response(null, { status: 200 });
      return new Response(JSON.stringify({ errcode: 0, data: { msgId: "file-1" } }), { status: 200 });
    }) as typeof fetch;
    const sender = createSender({
      tokenStore: { getAccessToken: async () => "tk", forceRefresh: async () => "tk" },
      fetchImpl,
    });
    await sender.sendLocalFile("g1", filePath);
    expect(bodies[1]).toEqual({
      receiver: "g1",
      message: { fileKey: "fk-2" },
      msgType: "file",
    });
  });

  it("recalls a private message and a group message", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    }) as typeof fetch;
    const sender = createSender({
      tokenStore: { getAccessToken: async () => "tk", forceRefresh: async () => "tk" },
      fetchImpl,
    });
    const msgId = "794076f2-68b1-4d0e-94eb-c15946580b56";
    await sender.recall({ msgId, sessionId: "a@corp.netease.com", sessionType: 1 });
    await sender.recall({ msgId, sessionId: "g1", sessionType: 3 });
    expect(seen[0].url).toBe(`https://open.popo.netease.com/open-apis/robots/v1/im/${msgId}/recall`);
    expect(seen[0].body).toEqual({ sessionId: "a@corp.netease.com", sessionType: 1 });
    expect(seen[1].body).toEqual({ sessionId: "g1", sessionType: 3 });
  });
});
