import { describe, it, expect } from "vitest";
import { chatReducer, initialState } from "../../src/reducers/chatReducer";
import type {
  Message,
  TextBlock,
  ToolBlock,
  ReasoningBlock,
  ErrorBlock,
  SessionMetadata,
} from "../../src/types";

describe("chatReducer", () => {
  describe("APPEND_MESSAGE", () => {
    it("should append a new message to the end of the list", () => {
      const existingMessage: Message = {
        id: "msg-1",
        role: "user",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [existingMessage] };

      const newMessage: Message = {
        id: "msg-2",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };

      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: newMessage,
      });

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0]).toBe(existingMessage);
      expect(newState.messages[1]).toBe(newMessage);
    });

    it("should append to empty message list", () => {
      const state = { ...initialState, messages: [] };
      const newMessage: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };

      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: newMessage,
      });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toBe(newMessage);
    });

    it("should NOT append a message whose id already exists (straggler delta dedup)", () => {
      // hostBridge clears knownAssistantIds on turn end / error / session switch;
      // a straggler assistant:message / message:delta / tool:update for an id
      // already in the list must not re-append it (duplicate React key warning).
      const existingMessage: Message = {
        id: "msg-637d7f40-db64-4433-a6c0-71d4f9a7ea45",
        role: "assistant",
        timestamp: "0",
        blocks: [{ type: "text", content: "已存在的内容" }],
      };
      const state = { ...initialState, messages: [existingMessage] };

      const duplicate: Message = {
        id: "msg-637d7f40-db64-4433-a6c0-71d4f9a7ea45",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };

      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: duplicate,
      });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toBe(existingMessage);
      expect(newState.messages[0].blocks).toHaveLength(1);
    });

    it("drops the optimistic user bubble when the SDK echo already landed", () => {
      // Fast turns: user:message is applied before the host's appendMessage.
      // A second bubble with a client id must not appear under 思考中...
      const echoed: Message = {
        id: "msg-real-uuid",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "了解 nasl" }],
      };
      const state = { ...initialState, messages: [echoed] };
      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "user_opt1",
          role: "user",
          timestamp: "1",
          blocks: [{ type: "text", content: "了解 nasl" }],
        },
      });
      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].id).toBe("msg-real-uuid");
    });

    it("aligns the optimistic bubble when the SDK echo is appended after it", () => {
      // Host appendMessage already committed; user:message then APPEND_MESSAGE
      // with a real id (router missed the bubble because stateRef lagged).
      const optimistic: Message = {
        id: "user_opt1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "/pm-api https://example.com 修一下" }],
      };
      const state = { ...initialState, messages: [optimistic] };
      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "msg-real-uuid",
          role: "user",
          timestamp: "1",
          blocks: [{ type: "text", content: "/pm-api https://example.com 修一下" }],
        },
      });
      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].id).toBe("msg-real-uuid");
      expect(newState.messages[0].blocks).toEqual([
        { type: "text", content: "/pm-api https://example.com 修一下" },
      ]);
    });

    it("aligns the optimistic bubble even when an isMeta user is the nearest user", () => {
      const optimistic: Message = {
        id: "user_opt1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "/skill hello" }],
      };
      const meta: Message = {
        id: "msg-meta",
        role: "user",
        isMeta: true,
        timestamp: "1",
        blocks: [{ type: "text", content: "SessionStart hook" }],
      };
      const state = { ...initialState, messages: [optimistic, meta] };
      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "msg-real-uuid",
          role: "user",
          timestamp: "2",
          blocks: [{ type: "text", content: "/skill hello" }],
        },
      });
      expect(newState.messages.map((m) => m.id)).toEqual([
        "msg-real-uuid",
        "msg-meta",
      ]);
    });

    it("still appends a second send of the same text after the first echo", () => {
      const first: Message = {
        id: "msg-real-1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "hi" }],
      };
      const state = { ...initialState, messages: [first] };
      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "user_opt2",
          role: "user",
          timestamp: "1",
          blocks: [{ type: "text", content: "hi" }],
        },
      });
      expect(newState.messages).toHaveLength(1);

      const secondEcho = chatReducer(newState, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "msg-real-2",
          role: "user",
          timestamp: "2",
          blocks: [{ type: "text", content: "hi" }],
        },
      });
      expect(secondEcho.messages.map((m) => m.id)).toEqual([
        "msg-real-1",
        "msg-real-2",
      ]);
    });

    it("should pin currentSession.firstMessage when the first user message arrives incrementally", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, currentSession };

      const newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "u1",
          role: "user",
          timestamp: "0",
          blocks: [{ type: "text", content: "帮我重构登录模块" }],
        },
      });

      expect(newState.currentSession?.firstMessage).toBe("帮我重构登录模块");
    });

    it("should keep the title pinned via APPEND_MESSAGE after compaction truncates the list", () => {
      // Desktop sequence: session pushed without firstMessage, user/assistant
      // messages arrive incrementally, then compaction pushes the truncated
      // list ([assistant(compact), ...assistant-only tail]).
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      let state: typeof initialState = { ...initialState, currentSession };

      state = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "u1",
          role: "user",
          timestamp: "0",
          blocks: [{ type: "text", content: "帮我重构登录模块" }],
        },
      });
      state = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "a1",
          role: "assistant",
          timestamp: "0",
          blocks: [{ type: "text", content: "好的" }],
        },
      });

      const compacted = chatReducer(state, {
        type: "SET_MESSAGES",
        payload: [
          {
            id: "c1",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "compact", content: "对话摘要" }],
          },
          {
            id: "a2",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "text", content: "继续" }],
          },
        ],
      });

      expect(compacted.currentSession?.firstMessage).toBe("帮我重构登录模块");
    });

    it("should not pin firstMessage from appended assistant or meta messages", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      let state: typeof initialState = { ...initialState, currentSession };

      state = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "m1",
          role: "user",
          timestamp: "0",
          isMeta: true,
          blocks: [{ type: "text", content: "系统提醒" }],
        },
      });
      state = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: {
          id: "a1",
          role: "assistant",
          timestamp: "0",
          blocks: [{ type: "text", content: "好的" }],
        },
      });

      expect(state.currentSession?.firstMessage).toBeUndefined();
    });
  });

  describe("UPDATE_STREAMING_CONTENT", () => {
    it("should update existing text block content and stage", () => {
      const textBlock: TextBlock = {
        type: "text",
        content: "Hello",
        stage: "streaming",
      };
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [textBlock],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_CONTENT",
        payload: { messageId: "msg-1", chunk: " World", stage: "streaming" },
      });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].blocks).toHaveLength(1);
      const updatedBlock = newState.messages[0].blocks[0] as TextBlock;
      expect(updatedBlock.content).toBe("Hello World");
      expect(updatedBlock.stage).toBe("streaming");
    });

    it("should update stage to end", () => {
      const textBlock: TextBlock = {
        type: "text",
        content: "Hello",
        stage: "streaming",
      };
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [textBlock],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_CONTENT",
        payload: { messageId: "msg-1", chunk: "", stage: "end" },
      });

      const updatedBlock = newState.messages[0].blocks[0] as TextBlock;
      expect(updatedBlock.stage).toBe("end");
      expect(updatedBlock.content).toBe("Hello");
    });

    it("should append text block if none exists", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_CONTENT",
        payload: { messageId: "msg-1", chunk: "Hello", stage: "streaming" },
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const newBlock = newState.messages[0].blocks[0] as TextBlock;
      expect(newBlock.type).toBe("text");
      expect(newBlock.content).toBe("Hello");
      expect(newBlock.stage).toBe("streaming");
    });

    it("should return original state if messageId not found", () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_CONTENT",
        payload: {
          messageId: "non-existent",
          chunk: "Hello",
          stage: "streaming",
        },
      });

      expect(newState).toBe(state);
    });
  });

  describe("UPDATE_STREAMING_REASONING", () => {
    it("should update existing reasoning block content and stage", () => {
      const reasoningBlock: ReasoningBlock = {
        type: "reasoning",
        content: "Thinking...",
        stage: "streaming",
      };
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [reasoningBlock],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_REASONING",
        payload: {
          messageId: "msg-1",
          chunk: " about this",
          stage: "streaming",
        },
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const updatedBlock = newState.messages[0].blocks[0] as ReasoningBlock;
      expect(updatedBlock.content).toBe("Thinking... about this");
      expect(updatedBlock.stage).toBe("streaming");
    });

    it("should append reasoning block if none exists", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_REASONING",
        payload: {
          messageId: "msg-1",
          chunk: "Thinking...",
          stage: "streaming",
        },
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const newBlock = newState.messages[0].blocks[0] as ReasoningBlock;
      expect(newBlock.type).toBe("reasoning");
      expect(newBlock.content).toBe("Thinking...");
    });

    it("should return original state if messageId not found", () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_REASONING",
        payload: {
          messageId: "non-existent",
          chunk: "Thinking...",
          stage: "streaming",
        },
      });

      expect(newState).toBe(state);
    });

    it("should stamp startTime when appending a streaming reasoning block", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_REASONING",
        payload: {
          messageId: "msg-1",
          chunk: "Thinking...",
          stage: "streaming",
        },
      });

      const newBlock = newState.messages[0].blocks[0] as ReasoningBlock;
      expect(typeof newBlock.startTime).toBe("number");
      expect(newBlock.endTime).toBeUndefined();
    });

    it("should preserve startTime and stamp endTime when reasoning finishes", () => {
      const reasoningBlock: ReasoningBlock = {
        type: "reasoning",
        content: "Thinking...",
        stage: "streaming",
        startTime: 1000,
      };
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [reasoningBlock],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_STREAMING_REASONING",
        payload: { messageId: "msg-1", chunk: "", stage: "end" },
      });

      const updatedBlock = newState.messages[0].blocks[0] as ReasoningBlock;
      expect(updatedBlock.stage).toBe("end");
      expect(updatedBlock.startTime).toBe(1000);
      expect(typeof updatedBlock.endTime).toBe("number");
    });
  });

  describe("UPDATE_TOOL_BLOCK", () => {
    it("should update existing tool block", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        id: "tool-1",
        name: "Bash",
        stage: "running",
        parameters: '{"command":"ls"}',
        result: "",
        success: false,
      };
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [toolBlock],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_TOOL_BLOCK",
        payload: {
          messageId: "msg-1",
          id: "tool-1",
          name: "Bash",
          stage: "end",
          result: "file1.txt\nfile2.txt",
          success: true,
          parameters: '{"command":"ls"}',
        },
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const updatedBlock = newState.messages[0].blocks[0] as ToolBlock;
      expect(updatedBlock.stage).toBe("end");
      expect(updatedBlock.result).toBe("file1.txt\nfile2.txt");
      expect(updatedBlock.success).toBe(true);
    });

    it("should return original state if messageId not found", () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: "UPDATE_TOOL_BLOCK",
        payload: {
          messageId: "non-existent",
          id: "tool-1",
          name: "Bash",
          stage: "end",
          result: "",
          success: false,
          parameters: "{}",
        },
      });

      expect(newState).toBe(state);
    });

    it("should add new tool block if not found (incremental callback scenario)", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_TOOL_BLOCK",
        payload: {
          messageId: "msg-1",
          id: "tool-new",
          name: "Bash",
          stage: "start",
          parameters: '{"command":"ls"}',
        },
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const newBlock = newState.messages[0].blocks[0] as ToolBlock;
      expect(newBlock.type).toBe("tool");
      expect(newBlock.id).toBe("tool-new");
      expect(newBlock.name).toBe("Bash");
      expect(newBlock.stage).toBe("start");
      expect(newBlock.parameters).toBe('{"command":"ls"}');
    });

    it("should add tool block alongside existing blocks", () => {
      const textBlock: TextBlock = {
        type: "text",
        content: "Let me run a command",
        stage: "end",
      };
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [textBlock],
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: "UPDATE_TOOL_BLOCK",
        payload: {
          messageId: "msg-1",
          id: "tool-1",
          name: "Bash",
          stage: "running",
          parameters: '{"command":"ls"}',
        },
      });

      expect(newState.messages[0].blocks).toHaveLength(2);
      expect(newState.messages[0].blocks[0].type).toBe("text");
      const toolBlock = newState.messages[0].blocks[1] as ToolBlock;
      expect(toolBlock.type).toBe("tool");
      expect(toolBlock.id).toBe("tool-1");
      expect(toolBlock.stage).toBe("running");
    });
  });

  describe("SET_MESSAGES", () => {
    it("should replace entire message list", () => {
      const oldMessage: Message = {
        id: "old",
        role: "user",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [oldMessage] };
      const newMessages: Message[] = [
        { id: "new-1", role: "user", timestamp: "0", blocks: [] },
        { id: "new-2", role: "assistant", timestamp: "0", blocks: [] },
      ];

      const newState = chatReducer(state, {
        type: "SET_MESSAGES",
        payload: newMessages,
      });

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0].id).toBe("new-1");
      expect(newState.messages[1].id).toBe("new-2");
    });

    it("should pin currentSession.firstMessage from the first user message while it is still in the list", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, currentSession };
      const newMessages: Message[] = [
        {
          id: "u1",
          role: "user",
          timestamp: "0",
          blocks: [{ type: "text", content: "帮我重构登录模块" }],
        },
        {
          id: "a1",
          role: "assistant",
          timestamp: "0",
          blocks: [{ type: "text", content: "好的" }],
        },
      ];

      const newState = chatReducer(state, {
        type: "SET_MESSAGES",
        payload: newMessages,
      });

      expect(newState.currentSession?.firstMessage).toBe("帮我重构登录模块");
    });

    it("should keep the pinned title after compaction truncates the message list", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, currentSession };

      // Pre-compaction: full list still contains the first user message.
      const withUser = chatReducer(state, {
        type: "SET_MESSAGES",
        payload: [
          {
            id: "u1",
            role: "user",
            timestamp: "0",
            blocks: [{ type: "text", content: "帮我重构登录模块" }],
          },
          {
            id: "a1",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "text", content: "好的" }],
          },
        ],
      });

      // Post-compaction: [assistant(compact), ...assistant-only tail rounds].
      const compacted = chatReducer(withUser, {
        type: "SET_MESSAGES",
        payload: [
          {
            id: "c1",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "compact", content: "对话摘要" }],
          },
          {
            id: "a2",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "text", content: "继续" }],
          },
        ],
      });

      expect(compacted.currentSession?.firstMessage).toBe("帮我重构登录模块");
    });

    it("should not overwrite an existing firstMessage", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        firstMessage: "原始标题",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, currentSession };

      const newState = chatReducer(state, {
        type: "SET_MESSAGES",
        payload: [
          {
            id: "u1",
            role: "user",
            timestamp: "0",
            blocks: [{ type: "text", content: "新首条消息" }],
          },
        ],
      });

      expect(newState.currentSession?.firstMessage).toBe("原始标题");
    });

    it("should leave firstMessage empty when the list has no user text message", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, currentSession };

      const newState = chatReducer(state, {
        type: "SET_MESSAGES",
        payload: [
          {
            id: "c1",
            role: "assistant",
            timestamp: "0",
            blocks: [{ type: "compact", content: "对话摘要" }],
          },
        ],
      });

      expect(newState.currentSession?.firstMessage).toBeUndefined();
    });
  });

  describe("APPEND_ERROR_BLOCK", () => {
    it("should append error block to last assistant message", () => {
      const textBlock: TextBlock = {
        type: "text",
        content: "Hello",
        stage: "end",
      };
      const assistantMessage: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [textBlock],
      };
      const state = { ...initialState, messages: [assistantMessage] };

      const newState = chatReducer(state, {
        type: "APPEND_ERROR_BLOCK",
        payload: { error: "API rate limit exceeded" },
      });

      expect(newState.messages[0].blocks).toHaveLength(2);
      const errorBlock = newState.messages[0].blocks[1] as ErrorBlock;
      expect(errorBlock.type).toBe("error");
      expect(errorBlock.content).toBe("API rate limit exceeded");
    });

    it("should append error block to last assistant message when multiple messages exist", () => {
      const userMessage: Message = {
        id: "msg-1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "Hi", stage: "end" }],
      };
      const assistantMessage: Message = {
        id: "msg-2",
        role: "assistant",
        timestamp: "0",
        blocks: [{ type: "text", content: "Hello", stage: "end" }],
      };
      const state = {
        ...initialState,
        messages: [userMessage, assistantMessage],
      };

      const newState = chatReducer(state, {
        type: "APPEND_ERROR_BLOCK",
        payload: { error: "Something went wrong" },
      });

      expect(newState.messages[1].blocks).toHaveLength(2);
      const errorBlock = newState.messages[1].blocks[1] as ErrorBlock;
      expect(errorBlock.type).toBe("error");
      expect(errorBlock.content).toBe("Something went wrong");
      // User message unchanged
      expect(newState.messages[0].blocks).toHaveLength(1);
    });

    it("should open a new assistant message when the latest turn is a user follow-up", () => {
      const assistantMessage: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [{ type: "text", content: "working", stage: "end" }],
      };
      const userFollowUp: Message = {
        id: "msg-2",
        role: "user",
        timestamp: "1",
        blocks: [{ type: "text", content: "改了么", stage: "end" }],
      };
      const state = {
        ...initialState,
        messages: [assistantMessage, userFollowUp],
      };

      const newState = chatReducer(state, {
        type: "APPEND_ERROR_BLOCK",
        payload: {
          error:
            "Failed to compact conversation history: Compaction failed: the model produced no summary output.",
        },
      });

      expect(newState.messages).toHaveLength(3);
      expect(newState.messages[0].blocks).toHaveLength(1);
      expect(newState.messages[1]).toBe(userFollowUp);
      const errorMessage = newState.messages[2];
      expect(errorMessage.role).toBe("assistant");
      const errorBlock = errorMessage.blocks[0] as ErrorBlock;
      expect(errorBlock.type).toBe("error");
      expect(errorBlock.content).toContain("Failed to compact");
    });

    it("should create a new assistant message with error block if no assistant message exists", () => {
      const userMessage: Message = {
        id: "msg-1",
        role: "user",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [userMessage] };

      const newState = chatReducer(state, {
        type: "APPEND_ERROR_BLOCK",
        payload: { error: "402 Payment Required" },
      });

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0]).toBe(userMessage);
      const errorMessage = newState.messages[1];
      expect(errorMessage.role).toBe("assistant");
      expect(errorMessage.blocks).toHaveLength(1);
      const errorBlock = errorMessage.blocks[0] as ErrorBlock;
      expect(errorBlock.type).toBe("error");
      expect(errorBlock.content).toBe("402 Payment Required");
    });

    it("should not mutate original state", () => {
      const assistantMessage: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };
      const state = { ...initialState, messages: [assistantMessage] };

      const newState = chatReducer(state, {
        type: "APPEND_ERROR_BLOCK",
        payload: { error: "Error" },
      });

      expect(state.messages[0].blocks).toHaveLength(0);
      expect(newState.messages[0].blocks).toHaveLength(1);
    });

    it("drops empty-turn errors when the assistant already has tools or text", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "Agent",
        parameters: "{}",
        compactParams: "Agent",
        stage: "start",
        id: "tool-1",
      };
      const assistantMessage: Message = {
        id: "msg-1",
        role: "assistant",
        timestamp: "0",
        blocks: [toolBlock],
      };
      const state = { ...initialState, messages: [assistantMessage] };

      const newState = chatReducer(state, {
        type: "APPEND_ERROR_BLOCK",
        payload: { error: "模型没有产生输出" },
      });

      expect(newState.messages[0].blocks).toEqual([toolBlock]);
    });

    it("drops a standalone empty-turn bubble when a real assistant message arrives", () => {
      const user: Message = {
        id: "u1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "hi", stage: "end" }],
      };
      const emptyTurn: Message = {
        id: "err-1",
        role: "assistant",
        timestamp: "1",
        blocks: [{ type: "error", content: "模型没有产生输出" }],
      };
      const state = { ...initialState, messages: [user, emptyTurn] };
      const thinking: Message = {
        id: "asst-1",
        role: "assistant",
        timestamp: "2",
        blocks: [],
      };
      const next = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: thinking,
      });
      expect(next.messages.map((m) => m.id)).toEqual(["u1", "asst-1"]);
    });
  });

  describe("Bang message flow", () => {
    it("APPEND_BANG_MESSAGE creates a user message with a running bang block", () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: "APPEND_BANG_MESSAGE",
        payload: { command: "ls -la", messageId: "bang-1" },
      });

      expect(newState.messages).toHaveLength(1);
      const msg = newState.messages[0];
      expect(msg.id).toBe("bang-1");
      expect(msg.role).toBe("user");
      expect(msg.blocks).toHaveLength(1);
      expect(msg.blocks[0]).toEqual({
        type: "bang",
        command: "ls -la",
        output: "",
        stage: "running",
        exitCode: null,
      });
    });

    it("APPEND_BANG_MESSAGE is a no-op when the message already exists", () => {
      const existing: Message = {
        id: "bang-1",
        role: "user",
        timestamp: "0",
        blocks: [
          {
            type: "bang",
            command: "ls",
            output: "x",
            stage: "end",
            exitCode: 0,
          },
        ],
      };
      const state = { ...initialState, messages: [existing] };

      const newState = chatReducer(state, {
        type: "APPEND_BANG_MESSAGE",
        payload: { command: "other", messageId: "bang-1" },
      });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toBe(existing);
    });

    it("UPDATE_BANG_MESSAGE merges command and output into the bang block", () => {
      const state = {
        ...initialState,
        messages: [
          {
            id: "bang-1",
            role: "user" as const,
            timestamp: "0",
            blocks: [
              {
                type: "bang" as const,
                command: "ls",
                output: "",
                stage: "running" as const,
                exitCode: null,
              },
            ],
          },
        ],
      };

      const newState = chatReducer(state, {
        type: "UPDATE_BANG_MESSAGE",
        payload: { command: "ls -la", output: "total 0", messageId: "bang-1" },
      });

      const block = newState.messages[0].blocks[0];
      expect(block).toEqual({
        type: "bang",
        command: "ls -la",
        output: "total 0",
        stage: "running",
        exitCode: null,
      });
    });

    it("UPDATE_BANG_MESSAGE is a no-op for an unknown messageId", () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: "UPDATE_BANG_MESSAGE",
        payload: { command: "ls", output: "x", messageId: "missing" },
      });

      expect(newState).toBe(state);
    });

    it("COMPLETE_BANG_MESSAGE stamps exitCode and transitions stage to end", () => {
      const state = {
        ...initialState,
        messages: [
          {
            id: "bang-1",
            role: "user" as const,
            timestamp: "0",
            blocks: [
              {
                type: "bang" as const,
                command: "false",
                output: "",
                stage: "running" as const,
                exitCode: null,
              },
            ],
          },
        ],
      };

      const newState = chatReducer(state, {
        type: "COMPLETE_BANG_MESSAGE",
        payload: {
          command: "false",
          exitCode: 1,
          messageId: "bang-1",
          output: "boom\n",
        },
      });

      const block = newState.messages[0].blocks[0];
      expect(block).toEqual({
        type: "bang",
        command: "false",
        output: "boom\n",
        stage: "end",
        exitCode: 1,
      });
    });

    it("COMPLETE_BANG_MESSAGE without output preserves the running-stage output", () => {
      const state = {
        ...initialState,
        messages: [
          {
            id: "bang-1",
            role: "user" as const,
            timestamp: "0",
            blocks: [
              {
                type: "bang" as const,
                command: "ls",
                output: "partial",
                stage: "running" as const,
                exitCode: null,
              },
            ],
          },
        ],
      };

      const newState = chatReducer(state, {
        type: "COMPLETE_BANG_MESSAGE",
        payload: { command: "ls", exitCode: 0, messageId: "bang-1" },
      });

      const block = newState.messages[0].blocks[0];
      expect(block).toEqual({
        type: "bang",
        command: "ls",
        output: "partial",
        stage: "end",
        exitCode: 0,
      });
    });

    it("COMPLETE_BANG_MESSAGE is a no-op for an unknown messageId", () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: "COMPLETE_BANG_MESSAGE",
        payload: { command: "ls", exitCode: 0, messageId: "missing" },
      });

      expect(newState).toBe(state);
    });
  });

  describe("User message flow", () => {
    it("should handle user message followed by assistant message", () => {
      const state = { ...initialState, messages: [] };

      // User sends a message
      const userMessage: Message = {
        id: "user-1",
        role: "user",
        timestamp: "0",
        blocks: [{ type: "text", content: "Hello", stage: "end" }],
      };
      let newState = chatReducer(state, {
        type: "APPEND_MESSAGE",
        payload: userMessage,
      });
      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].role).toBe("user");

      // Assistant starts responding
      const assistantMessage: Message = {
        id: "assistant-1",
        role: "assistant",
        timestamp: "0",
        blocks: [],
      };
      newState = chatReducer(newState, {
        type: "APPEND_MESSAGE",
        payload: assistantMessage,
      });
      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0].role).toBe("user");
      expect(newState.messages[1].role).toBe("assistant");

      // Assistant content streams in
      newState = chatReducer(newState, {
        type: "UPDATE_STREAMING_CONTENT",
        payload: {
          messageId: "assistant-1",
          chunk: "Hi there",
          stage: "streaming",
        },
      });
      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[1].blocks).toHaveLength(1);
      expect((newState.messages[1].blocks[0] as TextBlock).content).toBe(
        "Hi there",
      );
    });
  });

  describe("SET_CURRENT_SESSION", () => {
    it("should backfill firstMessage from sessions list when payload lacks it", () => {
      const sessionInList: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        firstMessage: "压缩块摘要内容",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, sessions: [sessionInList] };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: {
          id: "s1",
          sessionType: "main",
          workdir: "/w",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
          latestTotalTokens: 0,
        },
      });

      expect(newState.currentSession?.firstMessage).toBe("压缩块摘要内容");
    });

    it("should not override firstMessage when payload already has one", () => {
      const sessionInList: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        firstMessage: "列表里的摘要",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, sessions: [sessionInList] };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: {
          id: "s1",
          sessionType: "main",
          firstMessage: "payload自带的",
          workdir: "/w",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
          latestTotalTokens: 0,
        },
      });

      expect(newState.currentSession?.firstMessage).toBe("payload自带的");
    });

    it("should not backfill firstMessage when session is not in sessions list", () => {
      const state = { ...initialState, sessions: [] };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: {
          id: "new-session",
          sessionType: "main",
          workdir: "/w",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
          latestTotalTokens: 0,
        },
      });

      expect(newState.currentSession?.firstMessage).toBeUndefined();
    });

    it("should clear currentSession when payload is undefined without error", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = { ...initialState, currentSession };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: undefined,
      });

      expect(newState.currentSession).toBeUndefined();
    });

    it("clears background tasks when switching to another session", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = {
        ...initialState,
        currentSession,
        backgroundTasks: [
          {
            id: "task_138_1",
            type: "workflow" as const,
            status: "running" as const,
            startTime: 1,
            description: "Workflow: Icap-ide-analysis",
          },
        ],
        workflowRuns: [{ runId: "r1" } as never],
        tasks: [{ id: "t1" } as never],
        activeDialog: "workflows",
      };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: {
          id: "s2",
          sessionType: "main",
          workdir: "/w",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
          latestTotalTokens: 0,
        },
      });

      expect(newState.backgroundTasks).toEqual([]);
      expect(newState.workflowRuns).toEqual([]);
      expect(newState.tasks).toEqual([]);
      expect(newState.activeDialog).toBeNull();
    });

    it("clears a stale compaction hint when switching to another session", () => {
      // Desktop session switches use updateCurrentSession, not setInitialState.
      // The compaction flag is session-scoped UI; leaking it makes every
      // conversation show "正在压缩对话…".
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = {
        ...initialState,
        currentSession,
        isCompacting: true,
      };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: {
          id: "s2",
          sessionType: "main",
          workdir: "/w",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
          latestTotalTokens: 0,
        },
      });

      expect(newState.isCompacting).toBe(false);
    });

    it("keeps the compaction hint when the same session is patched", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = {
        ...initialState,
        currentSession,
        isCompacting: true,
      };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: {
          ...currentSession,
          model: "m2",
        },
      });

      expect(newState.isCompacting).toBe(true);
    });

    it("keeps background tasks when the same session is patched", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const backgroundTasks = [
        {
          id: "task_138_1",
          type: "workflow" as const,
          status: "running" as const,
          startTime: 1,
        },
      ];
      const state = { ...initialState, currentSession, backgroundTasks };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: { ...currentSession, firstMessage: "same session" },
      });

      expect(newState.backgroundTasks).toEqual(backgroundTasks);
    });

    it("clears subagent transcripts when switching to another session", () => {
      // SET_MESSAGES merges (never replaces) subagentMessages, so transcripts
      // from a previous session would otherwise be pinned in memory forever.
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const state = {
        ...initialState,
        currentSession,
        subagentMessages: {
          "subagent-old": [
            { id: "m1", role: "assistant" as const, timestamp: "0", blocks: [] },
          ],
          "tool-old": [
            { id: "m2", role: "assistant" as const, timestamp: "0", blocks: [] },
          ],
        },
        agentToolSubagentIds: { "tool-old": "subagent-old" },
        pendingAgentToolIds: ["tool-pending"],
        unboundSubagentIds: ["subagent-pending"],
      };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: {
          id: "s2",
          sessionType: "main",
          workdir: "/w",
          createdAt: new Date(0),
          lastActiveAt: new Date(0),
          latestTotalTokens: 0,
        },
      });

      expect(newState.subagentMessages).toEqual({});
      expect(newState.agentToolSubagentIds).toEqual({});
      expect(newState.pendingAgentToolIds).toEqual([]);
      expect(newState.unboundSubagentIds).toEqual([]);
    });

    it("keeps subagent transcripts when the same session is patched", () => {
      const currentSession: SessionMetadata = {
        id: "s1",
        sessionType: "main",
        workdir: "/w",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
        latestTotalTokens: 0,
      };
      const subagentMessages = {
        "subagent-1": [
          { id: "m1", role: "assistant" as const, timestamp: "0", blocks: [] },
        ],
      };
      const state = { ...initialState, currentSession, subagentMessages };

      const newState = chatReducer(state, {
        type: "SET_CURRENT_SESSION",
        payload: { ...currentSession, model: "m2" },
      });

      expect(newState.subagentMessages).toEqual(subagentMessages);
    });
  });

  describe("SET_INITIAL_STATE", () => {
    it("should pin firstMessage from the initial messages when the pushed session lacks it", () => {
      // Desktop re-pushes pane state (setInitialState) with a session object
      // that never carries firstMessage; the title must be re-derived from the
      // same-snapshot messages so a pane switch does not drop the pinned title.
      const newState = chatReducer(initialState, {
        type: "SET_INITIAL_STATE",
        payload: {
          messages: [
            {
              id: "u1",
              role: "user",
              timestamp: "0",
              blocks: [{ type: "text", content: "帮我重构登录模块" }],
            },
            {
              id: "a1",
              role: "assistant",
              timestamp: "0",
              blocks: [{ type: "text", content: "好的" }],
            },
          ],
          sessions: [],
          currentSession: {
            id: "s1",
            sessionType: "main",
            workdir: "/w",
            createdAt: new Date(0),
            lastActiveAt: new Date(0),
            latestTotalTokens: 0,
          },
          configurationData: {},
          pendingConfirmations: [],
          isStreaming: false,
        },
      });

      expect(newState.currentSession?.firstMessage).toBe("帮我重构登录模块");
    });

    it("should not overwrite a firstMessage already present on the pushed session", () => {
      const newState = chatReducer(initialState, {
        type: "SET_INITIAL_STATE",
        payload: {
          messages: [
            {
              id: "u1",
              role: "user",
              timestamp: "0",
              blocks: [{ type: "text", content: "新首条消息" }],
            },
          ],
          sessions: [],
          currentSession: {
            id: "s1",
            sessionType: "main",
            firstMessage: "原始标题",
            workdir: "/w",
            createdAt: new Date(0),
            lastActiveAt: new Date(0),
            latestTotalTokens: 0,
          },
          configurationData: {},
          pendingConfirmations: [],
          isStreaming: false,
        },
      });

      expect(newState.currentSession?.firstMessage).toBe("原始标题");
    });

    it("SET_INITIAL_STATE clears a stale isCompacting so a session switch does not leak the compaction hint", () => {
      // Session A is mid-compaction: the view shows "正在压缩对话…".
      let state = chatReducer(initialState, {
        type: "SET_COMPACTING",
        payload: true,
      });
      expect(state.isCompacting).toBe(true);

      // User switches to session B, which is not compacting. The host pushes
      // setInitialState for B (isCompacting absent). The hint must not leak
      // from A into B.
      state = chatReducer(state, {
        type: "SET_INITIAL_STATE",
        payload: {
          messages: [],
          sessions: [],
          configurationData: {},
          pendingConfirmations: [],
          isStreaming: false,
        },
      });

      expect(state.isCompacting).toBe(false);
    });

    it("SET_INITIAL_STATE preserves isCompacting when the host pushes a still-compacting session", () => {
      // Switching back to a session that is still compacting must keep the hint.
      const state = chatReducer(
        { ...initialState, isCompacting: false },
        {
          type: "SET_INITIAL_STATE",
          payload: {
            messages: [],
            sessions: [],
            configurationData: {},
            pendingConfirmations: [],
            isStreaming: false,
            isCompacting: true,
          },
        },
      );

      expect(state.isCompacting).toBe(true);
    });

    it("SET_INITIAL_STATE raises isRestoring when the host pushes a still-restoring session", () => {
      // The desktop host switches the pane to the selected historical session
      // immediately and keeps the sweep overlay up until the restore lands.
      const state = chatReducer(
        { ...initialState, isRestoring: false },
        {
          type: "SET_INITIAL_STATE",
          payload: {
            messages: [],
            sessions: [],
            configurationData: {},
            pendingConfirmations: [],
            isStreaming: false,
            isRestoring: true,
          },
        },
      );

      expect(state.isRestoring).toBe(true);
    });

    it("SET_INITIAL_STATE clears a stale isRestoring when absent (restore finished)", () => {
      // The host raises the overlay on selection, then drops it once the
      // restore lands — a push without the flag must not keep the overlay.
      let state = chatReducer(initialState, {
        type: "SET_INITIAL_STATE",
        payload: {
          messages: [],
          sessions: [],
          configurationData: {},
          pendingConfirmations: [],
          isStreaming: false,
          isRestoring: true,
        },
      });
      expect(state.isRestoring).toBe(true);

      state = chatReducer(state, {
        type: "SET_INITIAL_STATE",
        payload: {
          messages: [],
          sessions: [],
          configurationData: {},
          pendingConfirmations: [],
          isStreaming: false,
        },
      });

      expect(state.isRestoring).toBe(false);
    });
  });

  describe("theme state", () => {
    it("SET_INITIAL_STATE stores the theme payload and preserves it when absent", () => {
      const theme = { effective: "dark" as const };
      const newState = chatReducer(initialState, {
        type: "SET_INITIAL_STATE",
        payload: {
          messages: [],
          sessions: [],
          configurationData: {},
          pendingConfirmations: [],
          isStreaming: false,
          theme,
        },
      });
      expect(newState.theme).toEqual(theme);

      const withoutTheme = chatReducer(initialState, {
        type: "SET_INITIAL_STATE",
        payload: {
          messages: [],
          sessions: [],
          configurationData: {},
          pendingConfirmations: [],
          isStreaming: false,
        },
      });
      expect(withoutTheme.theme).toBeUndefined();
    });
  });

  describe("auth dialog state", () => {
    it("SHOW_DIALOG login opens the auth dialog", () => {
      const state = chatReducer(initialState, {
        type: "SHOW_DIALOG",
        payload: { type: "login" },
      });
      expect(state.activeDialog).toBe("login");
    });

    it("SET_LOGIN_ERROR surfaces the failure message", () => {
      const state = chatReducer(initialState, {
        type: "SET_LOGIN_ERROR",
        payload: "CodeMaker login timed out",
      });
      expect(state.loginError).toBe("CodeMaker login timed out");
    });

    it("HIDE_DIALOG clears the login error", () => {
      const withError = chatReducer(initialState, {
        type: "SET_LOGIN_ERROR",
        payload: "CodeMaker login timed out",
      });
      const state = chatReducer(withError, { type: "HIDE_DIALOG" });
      expect(state.activeDialog).toBeNull();
      expect(state.loginError).toBeUndefined();
    });

    it("successful auth clears the login error", () => {
      const withError = chatReducer(initialState, {
        type: "SET_LOGIN_ERROR",
        payload: "CodeMaker login timed out",
      });
      const state = chatReducer(withError, {
        type: "SET_AUTHENTICATED",
        payload: true,
      });
      expect(state.isAuthenticated).toBe(true);
      expect(state.loginError).toBeUndefined();
    });
  });
});
