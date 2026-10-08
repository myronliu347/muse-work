import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { viewAssistantEvent, type AssistantChatEvent, type AssistantEvent, type AssistantQueueView } from "./events.js";
import { normalizeAssistantImages } from "./messages.js";

type QueueFile = {
  version: 1;
  events: AssistantEvent[];
};

function queuePath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "assistant-queue.json");
}

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function sameChat(tail: AssistantEvent, next: AssistantEvent): tail is AssistantChatEvent {
  return next.type === "chat"
    && tail.type === "chat"
    && tail.retry !== 1
    && tail.from === next.from
    && (tail.user ?? "") === (next.user ?? "")
    && (tail.groupId ?? "") === (next.groupId ?? "");
}

function mergedChat(tail: AssistantChatEvent, next: AssistantChatEvent): AssistantChatEvent {
  const message = [tail.message, next.message]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n");
  const images = normalizeAssistantImages([...(tail.images ?? []), ...(next.images ?? [])]);
  return {
    type: "chat",
    from: tail.from,
    message,
    ...(tail.user ? { user: tail.user } : {}),
    ...(tail.groupId ? { groupId: tail.groupId } : {}),
    ...(images.length > 0 ? { images } : {}),
  };
}

function load(filePath: string): AssistantEvent[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as QueueFile;
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

export function createAssistantQueue(options: { home: string }): {
  enqueue(event: AssistantEvent): void;
  absorb(event: AssistantEvent, headLocked: boolean): boolean;
  peek(): AssistantEvent | undefined;
  list(): AssistantQueueView[];
  dropHead(): void;
  markRetry(turnError: string): void;
} {
  const filePath = queuePath(options.home);
  let events = load(filePath);

  function save(): void {
    const body: QueueFile = { version: 1, events };
    writeAtomically(filePath, `${JSON.stringify(body, null, 2)}\n`);
  }

  return {
    enqueue(event) {
      events.push(event);
      save();
    },
    absorb(event, headLocked) {
      const tail = events[events.length - 1];
      if (!tail || event.type !== "chat" || !sameChat(tail, event)) return false;
      if (headLocked && events.length === 1) return false;
      events[events.length - 1] = mergedChat(tail, event);
      save();
      return true;
    },
    peek() {
      return events[0];
    },
    list() {
      return events.map((event) => viewAssistantEvent(event));
    },
    dropHead() {
      events.shift();
      save();
    },
    markRetry(turnError) {
      const head = events[0];
      if (!head || head.retry === 1) return;
      events[0] = { ...head, retry: 1, turnError };
      save();
    },
  };
}
