import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { viewAssistantEvent, type AssistantEvent, type AssistantQueueView } from "./events.js";

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
