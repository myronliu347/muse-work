import fs from "node:fs";
import path from "node:path";

export type PopoChatType = "p2p" | "team";

export interface PopoMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  from?: string;
  to?: string;
  msgId?: string;
}

export interface PopoChat {
  chatKey: string;
  type: PopoChatType;
  title: string;
  waveSessionId?: string;
  /** agent 正在处理该会话的消息时为 true（详情页展示"处理中"） */
  processing?: boolean;
  messages: PopoMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatStore {
  getChat(chatKey: string): PopoChat | undefined;
  listChats(): PopoChat[];
  getOrCreateChat(chatKey: string, type: PopoChatType, title: string): PopoChat;
  appendMessage(chatKey: string, message: PopoMessage): void;
  setWaveSessionId(chatKey: string, waveSessionId: string): void;
  setProcessing(chatKey: string, processing: boolean): void;
}

export type ChatStoreOptions = {
  home: string;
  maxMessages?: number;
};

const DEFAULT_MAX_MESSAGES = 200;

export function createChatStore(options: ChatStoreOptions): ChatStore {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const file = path.join(options.home, ".muse-work", "popo-chats.json");
  const chats = new Map<string, PopoChat>();

  function load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        version?: number;
        chats?: Record<string, PopoChat>;
      };
      for (const [key, chat] of Object.entries(raw.chats ?? {})) {
        chats.set(key, chat);
      }
    } catch {
      // 文件不存在或损坏：从空开始
    }
  }

  function persist(): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ version: 1, chats: Object.fromEntries(chats) }, null, 2) + "\n",
      "utf8",
    );
    fs.renameSync(tmp, file);
  }

  load();

  return {
    getChat(chatKey) {
      return chats.get(chatKey);
    },
    listChats() {
      // updatedAt 倒序；同毫秒写入时 updatedAt 相同，用 chatKey 兜底保证排序确定
      return [...chats.values()].sort(
        (a, b) => b.updatedAt - a.updatedAt || a.chatKey.localeCompare(b.chatKey),
      );
    },
    getOrCreateChat(chatKey, type, title) {
      const existing = chats.get(chatKey);
      if (existing) return existing;
      const now = Date.now();
      const chat: PopoChat = {
        chatKey,
        type,
        title,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      chats.set(chatKey, chat);
      persist();
      return chat;
    },
    appendMessage(chatKey, message) {
      const chat = chats.get(chatKey);
      if (!chat) return;
      chat.messages.push(message);
      if (chat.messages.length > maxMessages) {
        chat.messages = chat.messages.slice(-maxMessages);
      }
      chat.updatedAt = Date.now();
      persist();
    },
    setWaveSessionId(chatKey, waveSessionId) {
      const chat = chats.get(chatKey);
      if (!chat) return;
      chat.waveSessionId = waveSessionId;
      persist();
    },
    setProcessing(chatKey, processing) {
      const chat = chats.get(chatKey);
      if (!chat) return;
      chat.processing = processing;
      persist();
    },
  };
}
