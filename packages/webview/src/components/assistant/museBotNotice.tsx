import React, { useEffect, useState } from "react";

type Notice = { id: string; text: string };

type NoticeState = {
  unread: boolean;
  notice: Notice | null;
};

const EMPTY: NoticeState = { unread: false, notice: null };

let state: NoticeState = EMPTY;
const listeners = new Set<() => void>();
let viewers = 0;
let listening = false;

function emit() {
  for (const listener of listeners) listener();
}

export function assistantNoticePreview(message: string): string {
  const body = message.replace(/\s+/g, " ").trim();
  if (!body) return "有新消息";
  return body.length > 80 ? `${body.slice(0, 79)}…` : body;
}

function onWindowMessage(event: MessageEvent) {
  const data = event.data as {
    command?: string;
    line?: { id?: unknown; role?: unknown; message?: unknown };
  } | null;
  if (!data || data.command !== "assistant:chat") return;
  if (viewers > 0) return;
  const line = data.line;
  if (!line || typeof line.id !== "string") return;
  if (line.role !== "user" && line.role !== "assistant") return;
  state = {
    unread: true,
    notice: {
      id: line.id,
      text: assistantNoticePreview(
        typeof line.message === "string" ? line.message : "",
      ),
    },
  };
  emit();
}

function ensureListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", onWindowMessage);
}

/** True while this instance is showing the Muse Bot home. Messages then stay on the page. */
export function useAssistantHomeVisible(visible: boolean) {
  useEffect(() => {
    ensureListening();
    if (!visible) return;
    viewers += 1;
    if (state.unread || state.notice) {
      state = EMPTY;
      emit();
    }
    return () => {
      viewers -= 1;
    };
  }, [visible]);
}

export function useAssistantNotice(): NoticeState {
  const [snapshot, setSnapshot] = useState(state);
  useEffect(() => {
    ensureListening();
    const pull = () => setSnapshot(state);
    listeners.add(pull);
    pull();
    return () => {
      listeners.delete(pull);
    };
  }, []);
  return snapshot;
}

export function dismissAssistantNotice() {
  if (!state.notice) return;
  state = { ...state, notice: null };
  emit();
}

export function resetAssistantNoticeForTests() {
  viewers = 0;
  state = EMPTY;
  if (listening && typeof window !== "undefined") {
    window.removeEventListener("message", onWindowMessage);
    listening = false;
  }
  emit();
}

/** Top-right notice when Muse Bot receives a message away from its home. */
export function AssistantNotice({ onOpen }: { onOpen: () => void }) {
  const { notice } = useAssistantNotice();
  if (!notice) return null;
  return (
    <div className="assistant-notice" data-testid="assistant-notice" role="status">
      <button type="button" className="assistant-notice-open" onClick={onOpen}>
        <span className="assistant-notice-title">灵光</span>
        <span className="assistant-notice-body">{notice.text}</span>
      </button>
      <button
        type="button"
        className="assistant-notice-close"
        aria-label="关闭通知"
        onClick={dismissAssistantNotice}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
