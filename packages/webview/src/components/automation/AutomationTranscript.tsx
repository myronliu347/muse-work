import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { MuseApiClient, MuseAutomationRun } from "../../muse/apiClient";
import { MarkdownView } from "../message/MarkdownView";

type TranscriptBlock = {
  type: string;
  content?: string;
  name?: string;
  result?: string;
  success?: boolean;
};

type TranscriptMessage = {
  id?: string;
  role: string;
  blocks: TranscriptBlock[];
};

function asMessages(raw: unknown[]): TranscriptMessage[] {
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const rec = item as Record<string, unknown>;
    const role = typeof rec.role === "string" ? rec.role : "assistant";
    const blocks = Array.isArray(rec.blocks)
      ? (rec.blocks.filter(
          (block) => block && typeof block === "object",
        ) as TranscriptBlock[])
      : [];
    if (blocks.length === 0 && typeof rec.content === "string") {
      return [
        {
          id: typeof rec.id === "string" ? rec.id : `m${index}`,
          role,
          blocks: [{ type: "text", content: rec.content }],
        },
      ];
    }
    return [
      {
        id: typeof rec.id === "string" ? rec.id : `m${index}`,
        role,
        blocks,
      },
    ];
  });
}

function coalesceTurns(messages: TranscriptMessage[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const message of messages) {
    const last = out[out.length - 1];
    if (last && last.role === message.role) {
      last.blocks = [...last.blocks, ...message.blocks];
      continue;
    }
    out.push({ ...message, blocks: [...message.blocks] });
  }
  return out;
}

function stripTriggerPreamble(text: string): string {
  const match = /^触发[:：]\s*(.+?)\n+---\n+([\s\S]*)$/.exec(text.trim());
  return (match ? match[2] : text).trim();
}

function textOf(blocks: TranscriptBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.content ?? "")
    .join("\n")
    .trim();
}

function markdownHtml(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true });
  return DOMPurify.sanitize(typeof html === "string" ? html : "", {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
    ],
    ALLOWED_ATTR: ["href", "class"],
  });
}

export const AutomationTranscript: React.FC<{
  api: MuseApiClient;
  run: MuseAutomationRun;
  onClose: () => void;
  onStop: () => void;
}> = ({ api, run, onClose, onStop }) => {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!run.sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      void api
        .getMessages(run.sessionId!)
        .then((res) => {
          if (!cancelled) setMessages(coalesceTurns(asMessages(res.messages)));
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
    };
    load();
    const timer =
      run.status === "running" ? window.setInterval(load, 1500) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [api, run.sessionId, run.status]);

  return (
    <div className="automations-transcript" data-testid="automation-transcript">
      <div className="automations-transcript-h">
        <button type="button" className="automations-link-btn" onClick={onClose}>
          返回
        </button>
        <span className="automations-grow" />
        {run.status === "running" ? (
          <button
            type="button"
            className="automations-link-btn"
            onClick={onStop}
          >
            停止
          </button>
        ) : null}
      </div>
      <div className="automations-msgs">
        {run.status === "skipped" ? (
          <div className="automations-note">
            未启动 Agent。
            {run.skipReason === "rule_running"
              ? "该规则已有一轮在跑。"
              : run.skipReason === "global_concurrency"
                ? "同时运行的自动化已达上限。"
                : ""}
          </div>
        ) : null}
        {error ? <div className="automations-note">{error}</div> : null}
        {messages.map((message, index) => (
          <TranscriptBubble key={message.id ?? index} message={message} />
        ))}
        {run.status === "running" && messages.length === 0 && !error ? (
          <div className="automations-note">正在执行…</div>
        ) : null}
      </div>
    </div>
  );
};

const TranscriptBubble: React.FC<{ message: TranscriptMessage }> = ({
  message,
}) => {
  const rawText = textOf(message.blocks);
  const body =
    message.role === "user" ? stripTriggerPreamble(rawText) : rawText;
  const tools = message.blocks.filter((block) => block.type === "tool");
  if (!body && tools.length === 0) return null;
  return (
    <div className={`automations-msg automations-msg--${message.role}`}>
      {tools.length > 0 ? (
        <div className="automations-tools">
          {tools.map((tool, index) => (
            <span
              className="automations-tool"
              key={`${tool.name ?? "tool"}-${index}`}
            >
              {tool.name || "工具"}
            </span>
          ))}
        </div>
      ) : null}
      {body && message.role === "user" ? (
        <div className="automations-msg-body">{body}</div>
      ) : null}
      {body && message.role !== "user" ? (
        <MarkdownView className="automations-md" html={markdownHtml(body)} />
      ) : null}
    </div>
  );
};
