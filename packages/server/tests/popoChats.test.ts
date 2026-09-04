import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChatStore } from "../src/popo/chatStore.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "popo-chats-"));
}

describe("popo chatStore", () => {
  it("creates and persists a chat, reloadable across instances", () => {
    const home = tempHome();
    const store = createChatStore({ home });
    const chat = store.getOrCreateChat("p2p:me@corp.netease.com", "p2p", "me@corp.netease.com");
    expect(chat.waveSessionId).toBeUndefined();
    store.setWaveSessionId(chat.chatKey, "wave-1");
    store.appendMessage(chat.chatKey, { role: "user", content: "hi", at: "t1" });

    const reloaded = createChatStore({ home });
    const got = reloaded.getChat("p2p:me@corp.netease.com");
    expect(got?.waveSessionId).toBe("wave-1");
    expect(got?.messages).toEqual([{ role: "user", content: "hi", at: "t1" }]);
  });

  it("listChats returns chats sorted by updatedAt desc", () => {
    const store = createChatStore({ home: tempHome() });
    store.getOrCreateChat("team:1", "team", "群 1");
    store.appendMessage("team:1", { role: "user", content: "a", at: "t1" });
    store.getOrCreateChat("p2p:b@corp.netease.com", "p2p", "b@corp.netease.com");
    store.appendMessage("p2p:b@corp.netease.com", { role: "user", content: "b", at: "t2" });
    const chats = store.listChats();
    expect(chats.map((c) => c.chatKey)).toEqual(["p2p:b@corp.netease.com", "team:1"]);
  });

  it("notifies onChange when a new chat is created, not when it already exists", () => {
    const home = tempHome();
    const changes: string[] = [];
    const store = createChatStore({
      home,
      onChange: () => changes.push("change"),
    });
    store.getOrCreateChat("team:new", "team", "群 new");
    expect(changes).toHaveLength(1);
    store.getOrCreateChat("team:new", "team", "群 new");
    expect(changes).toHaveLength(1);
  });

  it("setProcessing persists across reload", () => {
    const home = tempHome();
    const store = createChatStore({ home });
    const chat = store.getOrCreateChat("p2p:me@corp.netease.com", "p2p", "me@corp.netease.com");
    expect(chat.processing).toBeUndefined();
    store.setProcessing(chat.chatKey, true);
    expect(store.getChat(chat.chatKey)?.processing).toBe(true);
    store.setProcessing(chat.chatKey, false);
    expect(store.getChat(chat.chatKey)?.processing).toBe(false);
    const reloaded = createChatStore({ home });
    expect(reloaded.getChat(chat.chatKey)?.processing).toBe(false);
  });

  it("caps messages at maxMessages", () => {
    const store = createChatStore({ home: tempHome(), maxMessages: 3 });
    const chat = store.getOrCreateChat("p2p:x@corp.netease.com", "p2p", "x");
    for (let i = 0; i < 5; i += 1) {
      store.appendMessage(chat.chatKey, { role: "user", content: String(i), at: `t${i}` });
    }
    expect(store.getChat(chat.chatKey)?.messages.map((m) => m.content)).toEqual(["2", "3", "4"]);
  });

  it("clearMessages empties history, keeps waveSessionId, and persists", () => {
    const home = tempHome();
    const store = createChatStore({ home });
    const chat = store.getOrCreateChat("p2p:me@corp.netease.com", "p2p", "me@corp.netease.com");
    store.setWaveSessionId(chat.chatKey, "wave-1");
    store.appendMessage(chat.chatKey, { role: "user", content: "hi", at: "t1" });
    store.appendMessage(chat.chatKey, { role: "assistant", content: "yo", at: "t2" });

    store.clearMessages(chat.chatKey);
    const got = store.getChat(chat.chatKey);
    expect(got?.messages).toEqual([]);
    // agent 侧会话由 runner.clear 换新，展示层不动 waveSessionId
    expect(got?.waveSessionId).toBe("wave-1");

    const reloaded = createChatStore({ home });
    const reloadedChat = reloaded.getChat(chat.chatKey);
    expect(reloadedChat?.messages).toEqual([]);
    expect(reloadedChat?.waveSessionId).toBe("wave-1");
  });

  it("clearMessages on missing chat is a no-op", () => {
    const store = createChatStore({ home: tempHome() });
    expect(() => store.clearMessages("p2p:nobody@corp.netease.com")).not.toThrow();
  });

  it("deleteChat removes the chat and persists", () => {
    const home = tempHome();
    const store = createChatStore({ home });
    store.getOrCreateChat("p2p:me@corp.netease.com", "p2p", "me@corp.netease.com");
    store.appendMessage("p2p:me@corp.netease.com", { role: "user", content: "hi", at: "t1" });
    expect(store.deleteChat("p2p:me@corp.netease.com")).toBe(true);
    expect(store.getChat("p2p:me@corp.netease.com")).toBeUndefined();
    expect(store.listChats()).toEqual([]);
    const reloaded = createChatStore({ home });
    expect(reloaded.getChat("p2p:me@corp.netease.com")).toBeUndefined();
  });

  it("deleteChat returns false for a missing chat", () => {
    const store = createChatStore({ home: tempHome() });
    expect(store.deleteChat("p2p:nobody@corp.netease.com")).toBe(false);
  });
});
