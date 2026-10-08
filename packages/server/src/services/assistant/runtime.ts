import type { SessionRunner } from "../sessionRunner/index.js";
import type { SessionStore } from "../sessionStore.js";
import { formatAssistantEvent, type AssistantEvent } from "./events.js";
import type { createAssistantQueue } from "./queue.js";
import { ensureAssistantSession } from "./session.js";

type Queue = ReturnType<typeof createAssistantQueue>;

export function createAssistantRuntime(options: {
  home: string;
  model: string;
  sessions: SessionStore;
  runner: SessionRunner;
  queue: Queue;
  now?: () => Date;
}): {
  enqueue(event: AssistantEvent): void;
  onAssistantTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void;
  start(): void;
  stop(): void;
} {
  const { sessions, runner, queue } = options;
  let assistantId: string | undefined;
  let inflight = false;
  let stopped = false;

  function pump(): void {
    if (stopped || inflight || !assistantId) return;
    const head = queue.peek();
    if (!head) return;
    inflight = true;
    const images =
      head.type === "chat" && head.images && head.images.length > 0
        ? head.images
        : undefined;
    void runner
      .sendMessage(assistantId, formatAssistantEvent(head), images, "system-inject")
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        inflight = false;
        onAssistantTurnSettled(assistantId!, { ok: false, error: message });
      });
  }

  function onAssistantTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void {
    if (!assistantId || sessionId !== assistantId) return;
    inflight = false;
    const head = queue.peek();
    if (!head) return;
    if (result.ok) {
      queue.dropHead();
      pump();
      return;
    }
    if (head.retry !== 1) {
      queue.markRetry(result.error ?? "failed");
      pump();
      return;
    }
    const reason = head.turnError ?? result.error ?? "failed";
    queue.dropHead();
    void runner.appendSystemNote(
      assistantId,
      `type: failure\nerror: ${reason}`,
    );
    pump();
  }

  function start(): void {
    stopped = false;
    const session = ensureAssistantSession(sessions, {
      home: options.home,
      model: options.model,
    });
    assistantId = session.id;
    pump();
  }

  function stop(): void {
    stopped = true;
  }

  return {
    enqueue(event) {
      queue.enqueue(event);
      pump();
    },
    onAssistantTurnSettled,
    start,
    stop,
  };
}
