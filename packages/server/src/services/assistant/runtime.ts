import type { SessionRunner } from "../sessionRunner/index.js";
import type { SessionStore } from "../sessionStore.js";
import {
  formatAssistantEvents,
  type AssistantChatEvent,
  type AssistantEvent,
  type AssistantQueueView,
} from "./events.js";
import { normalizeAssistantImages } from "./messages.js";
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
  onActivity?: (working: boolean) => void;
  onQueue?: (items: AssistantQueueView[]) => void;
}): {
  enqueue(event: AssistantEvent): void;
  onAssistantTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void;
  working(): boolean;
  queueItems(): AssistantQueueView[];
  start(): void;
  stop(): void;
} {
  const { sessions, runner, queue } = options;
  let assistantId: string | undefined;
  let inflight = false;
  let inflightSources = new Set<string>();
  let stopped = false;

  function chatSource(event: AssistantEvent): string | undefined {
    if (event.type !== "chat") return undefined;
    return `${event.from}\0${event.user ?? ""}\0${event.groupId ?? ""}`;
  }

  function rememberSources(batch: AssistantEvent[]): void {
    inflightSources = new Set(
      batch.flatMap((event) => {
        const source = chatSource(event);
        return source ? [source] : [];
      }),
    );
  }

  function deliverNow(event: AssistantChatEvent): void {
    if (!assistantId) {
      if (!queue.absorb(event, inflight)) queue.enqueue(event);
      return;
    }
    const images = normalizeAssistantImages(event.images ?? []);
    void runner
      .sendMessage(
        assistantId,
        formatAssistantEvents([event]),
        images.length > 0 ? images : undefined,
        "system-inject",
      )
      .catch(() => {
        if (!queue.absorb(event, true)) queue.enqueue(event);
        notify();
      });
  }

  function publishQueue(): void {
    options.onQueue?.(queue.list());
  }

  function notify(): void {
    options.onActivity?.(!stopped && (inflight || queue.peek() !== undefined));
    publishQueue();
  }

  function pump(): void {
    if (stopped || inflight || !assistantId) return;
    const batch = queue.claimBatch();
    if (batch.length === 0) return;
    inflight = true;
    rememberSources(batch);
    notify();
    const images = normalizeAssistantImages(
      batch.flatMap((event) => (event.type === "chat" ? event.images ?? [] : [])),
    );
    void runner
      .sendMessage(
        assistantId,
        formatAssistantEvents(batch),
        images.length > 0 ? images : undefined,
        "system-inject",
      )
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
    inflightSources = new Set();
    const head = queue.peek();
    if (!head) {
      notify();
      return;
    }
    if (result.ok) {
      queue.dropBatch();
      pump();
      notify();
      return;
    }
    if (head.retry !== 1) {
      queue.markBatchRetry(result.error ?? "failed");
      pump();
      notify();
      return;
    }
    const reason = head.turnError ?? result.error ?? "failed";
    queue.dropBatch();
    void runner.appendSystemNote(
      assistantId,
      `type: failure\nerror: ${reason}`,
    );
    pump();
    notify();
  }

  function start(): void {
    stopped = false;
    const session = ensureAssistantSession(sessions, {
      home: options.home,
      model: options.model,
    });
    assistantId = session.id;
    pump();
    publishQueue();
  }

  function stop(): void {
    stopped = true;
  }

  return {
    enqueue(event) {
      const source = chatSource(event);
      if (inflight && source && inflightSources.has(source)) {
        deliverNow(event);
        notify();
        return;
      }
      if (!queue.absorb(event, inflight)) queue.enqueue(event);
      pump();
      notify();
    },
    onAssistantTurnSettled,
    working: () => !stopped && (inflight || queue.peek() !== undefined),
    queueItems: () => queue.list(),
    start,
    stop,
  };
}
