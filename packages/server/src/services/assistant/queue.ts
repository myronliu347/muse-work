import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { viewAssistantEvent, type AssistantChatEvent, type AssistantEvent, type AssistantQueueView } from "./events.js";
import { normalizeAssistantImages } from "./messages.js";

type QueueFile = {
  version: 1;
  events: AssistantEvent[];
  inflightCount?: number;
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

function load(filePath: string): { events: AssistantEvent[]; inflightCount: number } {
  if (!fs.existsSync(filePath)) return { events: [], inflightCount: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as QueueFile;
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    const requested = typeof parsed.inflightCount === "number" ? parsed.inflightCount : 0;
    const inflightCount = Math.max(0, Math.min(events.length, Math.floor(requested)));
    return { events, inflightCount };
  } catch {
    return { events: [], inflightCount: 0 };
  }
}

export function createAssistantQueue(options: { home: string }): {
  enqueue(event: AssistantEvent): void;
  absorb(event: AssistantEvent, headLocked: boolean): boolean;
  claimBatch(): AssistantEvent[];
  peek(): AssistantEvent | undefined;
  list(): AssistantQueueView[];
  dropHead(): void;
  dropBatch(): void;
  markRetry(turnError: string): void;
  markBatchRetry(turnError: string): void;
} {
  const filePath = queuePath(options.home);
  let { events, inflightCount } = load(filePath);

  function save(): void {
    const body: QueueFile = {
      version: 1,
      events,
      ...(inflightCount > 0 ? { inflightCount } : {}),
    };
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
      if (inflightCount > 0 && events.length <= inflightCount) return false;
      if (headLocked && events.length === 1) return false;
      events[events.length - 1] = mergedChat(tail, event);
      save();
      return true;
    },
    claimBatch() {
      if (events.length === 0) return [];
      if (inflightCount === 0) {
        inflightCount = events.length;
        save();
      }
      return events.slice(0, inflightCount);
    },
    peek() {
      return events[0];
    },
    list() {
      return events.map((event, index) => {
        const view = viewAssistantEvent(event);
        return index < inflightCount ? { ...view, active: true as const } : view;
      });
    },
    dropHead() {
      events.shift();
      if (inflightCount > 0) inflightCount -= 1;
      save();
    },
    dropBatch() {
      if (inflightCount <= 0) return;
      events.splice(0, inflightCount);
      inflightCount = 0;
      save();
    },
    markRetry(turnError) {
      const head = events[0];
      if (!head || head.retry === 1) return;
      events[0] = { ...head, retry: 1, turnError };
      save();
    },
    markBatchRetry(turnError) {
      if (inflightCount <= 0) return;
      const head = events[0];
      if (!head || head.retry === 1) return;
      for (let index = 0; index < inflightCount; index += 1) {
        const event = events[index];
        if (!event || event.retry === 1) continue;
        events[index] = { ...event, retry: 1, turnError };
      }
      save();
    },
  };
}
