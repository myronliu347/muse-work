import { describe, expect, it } from "vitest";
import { chatReducer, initialState } from "../../src/reducers/chatReducer";
import {
  parseAgentPrompt,
  resolveSubagentMessages,
} from "../../src/utils/subagentTranscript";
import type { Message } from "../../src/types";

describe("subagent transcript", () => {
  it("creates a nested assistant message and appends text without touching the main list", () => {
    const main: Message = {
      id: "main-1",
      role: "user",
      timestamp: "0",
      blocks: [{ type: "text", content: "go" }],
    };
    const state = { ...initialState, messages: [main] };

    const withMessage = chatReducer(state, {
      type: "APPEND_SUBAGENT_MESSAGE",
      payload: { subagentId: "sa1", messageId: "sm1" },
    });
    expect(withMessage.messages).toEqual([main]);
    expect(withMessage.subagentMessages.sa1).toHaveLength(1);
    expect(withMessage.subagentMessages.sa1[0].id).toBe("sm1");

    const withDelta = chatReducer(withMessage, {
      type: "UPDATE_SUBAGENT_STREAMING_CONTENT",
      payload: {
        subagentId: "sa1",
        messageId: "sm1",
        chunk: "nested",
        stage: "streaming",
      },
    });
    expect(withDelta.messages).toEqual([main]);
    expect(withDelta.subagentMessages.sa1[0].blocks[0]).toMatchObject({
      type: "text",
      content: "nested",
    });
  });

  it("updates a nested tool block under the subagent transcript", () => {
    const state = chatReducer(initialState, {
      type: "APPEND_SUBAGENT_MESSAGE",
      payload: { subagentId: "sa1", messageId: "sm1" },
    });
    const next = chatReducer(state, {
      type: "UPDATE_SUBAGENT_TOOL_BLOCK",
      payload: {
        subagentId: "sa1",
        params: {
          messageId: "sm1",
          id: "t1",
          name: "Read",
          stage: "end",
          success: true,
        },
      },
    });
    expect(next.subagentMessages.sa1[0].blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool", id: "t1", name: "Read" }),
      ]),
    );
  });

  it("binds a live Agent tool block to the next subagent transcript", () => {
    const withAgent = chatReducer(initialState, {
      type: "APPEND_MESSAGE",
      payload: {
        id: "main-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      },
    });
    const withTool = chatReducer(withAgent, {
      type: "UPDATE_TOOL_BLOCK",
      payload: {
        messageId: "main-1",
        id: "call-1",
        name: "Agent",
        stage: "running",
      },
    });
    const withNested = chatReducer(withTool, {
      type: "APPEND_SUBAGENT_MESSAGE",
      payload: { subagentId: "uuid-sa", messageId: "sm1" },
    });
    expect(withNested.agentToolSubagentIds["call-1"]).toBe("uuid-sa");
    expect(withNested.subagentMessages["uuid-sa"]).toHaveLength(1);
  });

  it("stores a full nested snapshot under the bound Agent tool id", () => {
    const withAgent = chatReducer(initialState, {
      type: "APPEND_MESSAGE",
      payload: {
        id: "main-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      },
    });
    const withTool = chatReducer(withAgent, {
      type: "UPDATE_TOOL_BLOCK",
      payload: {
        messageId: "main-1",
        id: "call-1",
        name: "Agent",
        stage: "running",
      },
    });
    const nested: Message[] = [
      {
        id: "sm1",
        role: "assistant",
        timestamp: "0",
        blocks: [{ type: "text", content: "explored" }],
      },
    ];
    const next = chatReducer(withTool, {
      type: "SET_SUBAGENT_MESSAGES",
      payload: { subagentId: "uuid-sa", messages: nested },
    });
    expect(next.subagentMessages["call-1"]).toEqual(nested);
    expect(next.subagentMessages["uuid-sa"]).toEqual(nested);
  });

  it("does not let a text-only snapshot wipe nested user messages and tools", () => {
    const rich: Message[] = [
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
          { type: "text", content: "explored" },
        ],
      },
    ];
    const withRich = chatReducer(initialState, {
      type: "SET_SUBAGENT_MESSAGES",
      payload: { subagentId: "uuid-sa", messages: rich },
    });
    const next = chatReducer(withRich, {
      type: "SET_SUBAGENT_MESSAGES",
      payload: {
        subagentId: "uuid-sa",
        messages: [
          {
            id: "sm1",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "text", content: "final only" }],
          },
        ],
      },
    });
    expect(next.subagentMessages["uuid-sa"]).toEqual(rich);
  });

  it("replaces nested transcript when the snapshot is richer", () => {
    const withText = chatReducer(initialState, {
      type: "SET_SUBAGENT_MESSAGES",
      payload: {
        subagentId: "uuid-sa",
        messages: [
          {
            id: "sm1",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "text", content: "partial" }],
          },
        ],
      },
    });
    const rich: Message[] = [
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
          { type: "text", content: "explored" },
        ],
      },
    ];
    const next = chatReducer(withText, {
      type: "SET_SUBAGENT_MESSAGES",
      payload: { subagentId: "uuid-sa", messages: rich },
    });
    expect(next.subagentMessages["uuid-sa"]).toEqual(rich);
  });

  it("does not fall back to result text when aliased transcripts exist", () => {
    const nested: Message[] = [
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
          { type: "text", content: "explored" },
        ],
      },
    ];
    const resolved = resolveSubagentMessages(
      { "uuid-sa": nested, "call-1": nested },
      { "call-1": "uuid-sa" },
      "",
      { fallbackText: "final result only" },
    );
    expect(resolved).toEqual(nested);
    expect(resolved.some((m) => m.role === "user")).toBe(true);
    expect(
      resolved.some((m) => m.blocks.some((b) => b.type === "tool")),
    ).toBe(true);
  });

  it("prepends parameters.prompt as a user message when the transcript has none", () => {
    const nested: Message[] = [
      {
        id: "sm1",
        role: "assistant",
        timestamp: "0",
        blocks: [
          { type: "tool", id: "t1", name: "Read", stage: "end", success: true },
          { type: "text", content: "explored" },
        ],
      },
    ];
    const resolved = resolveSubagentMessages(
      { "call-1": nested },
      {},
      "call-1",
      { prompt: "explore the repo structure" },
    );
    expect(resolved[0]).toMatchObject({
      role: "user",
      blocks: [{ type: "text", content: "explore the repo structure" }],
    });
    expect(resolved.slice(1)).toEqual(nested);
  });

  it("does not duplicate parameters.prompt when a leading user message already exists", () => {
    const nested: Message[] = [
      {
        id: "u1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "explore the repo structure" }],
      },
      {
        id: "sm1",
        role: "assistant",
        timestamp: "0",
        blocks: [{ type: "text", content: "explored" }],
      },
    ];
    const resolved = resolveSubagentMessages(
      { "call-1": nested },
      {},
      "call-1",
      { prompt: "explore the repo structure" },
    );
    expect(resolved.filter((m) => m.role === "user")).toHaveLength(1);
    expect(resolved).toEqual(nested);
  });

  it("reads prompt from Agent tool parameters JSON", () => {
    expect(
      parseAgentPrompt(
        JSON.stringify({
          subagent_type: "Explore",
          description: "结构",
          prompt: "explore the repo",
        }),
      ),
    ).toBe("explore the repo");
    expect(parseAgentPrompt("{")).toBeUndefined();
    expect(parseAgentPrompt('{"description":"x"}')).toBeUndefined();
  });

  it("hydrates nested Agent transcripts from loaded messages", () => {
    const nested: Message[] = [
      {
        id: "sm1",
        role: "assistant",
        timestamp: "0",
        blocks: [{ type: "text", content: "from disk" }],
      },
    ];
    const next = chatReducer(initialState, {
      type: "SET_MESSAGES",
      payload: [
        {
          id: "main-1",
          role: "assistant",
          timestamp: "0",
          blocks: [
            {
              type: "tool",
              id: "call-1",
              name: "Agent",
              stage: "end",
              nestedMessages: nested,
            } as Message["blocks"][number],
          ],
        },
      ],
    });
    expect(next.subagentMessages["call-1"]).toEqual(nested);
  });
});
