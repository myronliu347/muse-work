/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Message } from "../../src/components/Message";
import { AgentTranscriptPopup } from "../../src/components/AgentTranscriptPopup";
import { MuseTheme } from "../../src/ui/theme";
import { AGENT_TOOL_NAME } from "wave-agent-sdk/dist/constants/tools.js";
import type { Message as MessageType, VsCodeApi } from "../../src/types";

const vscode = {
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
} as unknown as VsCodeApi;

describe("Agent tool transcript", () => {
  it("opens a popup of nested messages when the Agent row is clicked", () => {
    const onOpenAgentTranscript = vi.fn();
    const message: MessageType = {
      id: "a1",
      role: "assistant",
      timestamp: "0",
      blocks: [
        {
          type: "tool",
          id: "sa1",
          name: AGENT_TOOL_NAME,
          stage: "end",
          compactParams: "Explore: 探索结构",
          parameters: JSON.stringify({
            subagent_type: "Explore",
            description: "探索结构",
          }),
          shortResult: "Agent completed (2 tools | 10 tokens)",
        },
      ],
    };

    render(
      <MuseTheme>
        <Message
          message={message}
          vscode={vscode}
          onOpenAgentTranscript={onOpenAgentTranscript}
        />
      </MuseTheme>,
    );

    fireEvent.click(screen.getByTestId("agent-tool-row"));
    expect(onOpenAgentTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sa1", name: AGENT_TOOL_NAME }),
    );
  });

  it("shimmers only the running tool name", () => {
    const message: MessageType = {
      id: "a1",
      role: "assistant",
      timestamp: "0",
      blocks: [
        {
          type: "tool",
          id: "t1",
          name: "Bash",
          stage: "running",
          compactParams: "ls -la",
        },
      ],
    };

    render(
      <MuseTheme>
        <Message message={message} vscode={vscode} />
      </MuseTheme>,
    );

    const name = screen.getByTestId("tool-name");
    expect(name).toHaveTextContent("Bash");
    expect(name.className).toContain("text-shimmer");
    expect(screen.getByText("ls -la").className).not.toContain("text-shimmer");
  });
});

describe("AgentTranscriptPopup", () => {
  it("renders nested messages inside the popup", () => {
    const nested: MessageType = {
      id: "sm1",
      role: "assistant",
      timestamp: "0",
      blocks: [{ type: "text", content: "nested hello" }],
    };

    render(
      <MuseTheme>
        <AgentTranscriptPopup
          title="Explore: 探索结构"
          messages={[nested]}
          vscode={vscode}
          onClose={vi.fn()}
        />
      </MuseTheme>,
    );

    expect(screen.getByTestId("agent-transcript-popup")).toBeTruthy();
    expect(screen.getByText("Explore: 探索结构")).toBeTruthy();
    expect(screen.getByText("nested hello")).toBeTruthy();
  });

  it("renders user prompts and nested tool calls, not only the final text", () => {
    const messages: MessageType[] = [
      {
        id: "u1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "explore the repo" }],
      },
      {
        id: "sm1",
        role: "assistant",
        timestamp: "0",
        blocks: [
          { type: "tool", id: "t1", name: "Read", stage: "end", success: true },
          { type: "text", content: "final answer" },
        ],
      },
    ];

    render(
      <MuseTheme>
        <AgentTranscriptPopup
          title="Explore: 探索结构"
          messages={messages}
          vscode={vscode}
          onClose={vi.fn()}
        />
      </MuseTheme>,
    );

    expect(screen.getByText("explore the repo")).toBeTruthy();
    expect(screen.getByTestId("tool-name")).toHaveTextContent("Read");
    expect(screen.getByText("final answer")).toBeTruthy();
    expect(
      screen.getByTestId("agent-transcript-popup").querySelector(".message-action-btn"),
    ).toBeNull();
  });

  it("shows empty copy when the nested transcript is missing", () => {
    render(
      <MuseTheme>
        <AgentTranscriptPopup
          title="Agent"
          messages={[]}
          vscode={vscode}
          onClose={vi.fn()}
        />
      </MuseTheme>,
    );
    expect(screen.getByText("暂无内部消息")).toBeTruthy();
  });
});
