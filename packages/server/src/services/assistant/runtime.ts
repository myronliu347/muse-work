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

const TURN_LIMIT_MS = 90_000;
const OVERRUN_NOTE =
  "上一轮超时被打断了，后面还有事件在等。被打断的工具没有做完。没做完的交给 Issue 接着做，然后处理下面的事件。不要停在这里。";

export function createAssistantRuntime(options: {
  home: string;
  sessions: SessionStore;
  runner: SessionRunner;
  queue: Queue;
  now?: () => Date;
  /** 测试注入。缺省为 Date.now。 */
  clock?: () => number;
  /** 测试注入。返回取消函数。缺省为 setTimeout。 */
  schedule?: (fn: () => void, ms: number) => () => void;
  onActivity?: (working: boolean) => void;
  onQueue?: (items: AssistantQueueView[]) => void;
}): {
  enqueue(event: AssistantEvent): void;
  onAssistantTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void;
  onCompactionSettled(sessionId: string): void;
  working(): boolean;
  queueItems(): AssistantQueueView[];
  start(): void;
  stop(): void;
} {
  const { sessions, runner, queue } = options;
  const clock = options.clock ?? Date.now;
  const schedule = options.schedule ?? defaultSchedule;
  let assistantId: string | undefined;
  let inflight = false;
  let inflightSources = new Set<string>();
  let stopped = false;
  let turnStartedAt = 0;
  let cancelLimit: (() => void) | undefined;
  let preempting = false;

  function stamp(event: AssistantEvent): AssistantEvent {
    if (event.timestamp !== undefined) return event;
    return { ...event, timestamp: clock() };
  }

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

  function syncAssistant(): void {
    const session = ensureAssistantSession(sessions, { home: options.home });
    assistantId = session.id;
  }

  function deliverNow(event: AssistantChatEvent): void {
    if (!assistantId) {
      if (!queue.absorb(event, inflight)) queue.enqueue(event);
      return;
    }
    syncAssistant();
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

  function clearLimit(): void {
    cancelLimit?.();
    cancelLimit = undefined;
  }

  function armLimit(): void {
    clearLimit();
    turnStartedAt = clock();
    cancelLimit = schedule(() => {
      cancelLimit = undefined;
      maybePreempt();
    }, TURN_LIMIT_MS);
  }

  function maybePreempt(): void {
    if (stopped || !inflight || preempting || !assistantId) return;
    if (clock() - turnStartedAt < TURN_LIMIT_MS) return;
    if (runner.isCompacting?.(assistantId)) return;
    if (!queue.hasWaiting()) return;
    preempting = true;
    clearLimit();
    void runner.abortMessage(assistantId).catch(() => {
      preempting = false;
    });
  }

  function beginTurn(batch: AssistantEvent[], note?: string): void {
    inflight = true;
    rememberSources(batch);
    syncAssistant();
    armLimit();
    notify();
    const images = normalizeAssistantImages(
      batch.flatMap((event) => (event.type === "chat" ? event.images ?? [] : [])),
    );
    const body = formatAssistantEvents(batch);
    void runner
      .sendMessage(
        assistantId!,
        note ? `${note}\n\n${body}` : body,
        images.length > 0 ? images : undefined,
        "system-inject",
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        inflight = false;
        onAssistantTurnSettled(assistantId!, { ok: false, error: message });
      });
  }

  function pump(): void {
    if (stopped || inflight || !assistantId) return;
    const batch = queue.claimBatch();
    if (batch.length === 0) return;
    beginTurn(batch);
  }

  function pumpPreempted(): void {
    if (stopped || inflight || !assistantId) return;
    const batch = queue.claimFirst();
    if (batch.length === 0) return;
    beginTurn(batch, OVERRUN_NOTE);
  }

  function onAssistantTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void {
    if (!assistantId || sessionId !== assistantId) return;
    const overrun = preempting;
    preempting = false;
    inflight = false;
    inflightSources = new Set();
    clearLimit();
    if (overrun) {
      queue.dropBatch();
      pumpPreempted();
      notify();
      return;
    }
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
    syncAssistant();
    pump();
    publishQueue();
  }

  function stop(): void {
    stopped = true;
    clearLimit();
  }

  return {
    enqueue(event) {
      event = stamp(event);
      if (inflight && event.type === "chat") {
        const source = chatSource(event);
        if (source && inflightSources.has(source)) {
          deliverNow(event);
          notify();
          return;
        }
      }
      if (!queue.absorb(event, inflight)) queue.enqueue(event);
      pump();
      maybePreempt();
      notify();
    },
    onAssistantTurnSettled,
    onCompactionSettled(sessionId) {
      if (!assistantId || sessionId !== assistantId) return;
      maybePreempt();
    },
    working: () => !stopped && (inflight || queue.peek() !== undefined),
    queueItems: () => queue.list(),
    start,
    stop,
  };
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}
