import React, { useEffect } from "react";
import { Message } from "../message/Message";
import { Tooltip } from "../shared/Tooltip";
import type { Message as MessageType, VsCodeApi } from "../../types";
import "../../styles/AgentTranscriptPopup.css";

export interface AgentTranscriptPopupProps {
  title: string;
  messages: MessageType[];
  vscode: VsCodeApi;
  onClose: () => void;
}

export const AgentTranscriptPopup: React.FC<AgentTranscriptPopupProps> = ({
  title,
  messages,
  vscode,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="agent-transcript-overlay"
      data-testid="agent-transcript-overlay"
      onClick={onClose}
    >
      <div
        className="agent-transcript-popup"
        data-testid="agent-transcript-popup"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-transcript-header">
          <div className="agent-transcript-title">{title}</div>
          <Tooltip text="关闭" position="bottom">
            <button
              type="button"
              className="agent-transcript-close"
              data-testid="agent-transcript-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <i className="codicon codicon-close" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className="agent-transcript-body">
          {messages.length === 0 ? (
            <div className="agent-transcript-empty">暂无内部消息</div>
          ) : (
            messages
              .filter((message) => !(message.role === "user" && message.isMeta))
              .map((message) => (
                <Message key={message.id} message={message} vscode={vscode} />
              ))
          )}
        </div>
      </div>
    </div>
  );
};
