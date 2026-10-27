import { describe, expect, it } from "vitest";
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "@muse-work/agent/constants";
import type { MessageBlock, ToolBlock } from "../../src/types";
import {
  segmentAssistantBlocks,
  segmentAssistantTurn,
  currentStatusLabel,
  summarizeActivity,
  toolHasDetail,
  toolLineLabel,
  toolPresentation,
} from "../../src/components/message/toolActivity";

function tool(
  name: string,
  parameters: Record<string, unknown>,
  extra: Partial<ToolBlock> = {},
): ToolBlock {
  return {
    type: "tool",
    name,
    parameters: JSON.stringify(parameters),
    stage: "end",
    success: true,
    ...extra,
  };
}

describe("segmentAssistantBlocks", () => {
  it("keeps a lone thought outside a tool group", () => {
    const blocks: MessageBlock[] = [
      {
        type: "reasoning",
        content: "先看一眼",
        stage: "end",
        startTime: 0,
        endTime: 8000,
      },
      { type: "text", content: "正文", stage: "end" },
    ];
    expect(segmentAssistantBlocks(blocks)).toEqual([
      { type: "single", index: 0 },
      { type: "single", index: 1 },
    ]);
  });

  it("folds tools and the thoughts between them into one run, split by text", () => {
    const blocks: MessageBlock[] = [
      { type: "text", content: "先说一句", stage: "end" },
      tool(GREP_TOOL_NAME, { pattern: "foo" }),
      {
        type: "reasoning",
        content: "再看",
        stage: "end",
        startTime: 0,
        endTime: 1000,
      },
      tool(READ_TOOL_NAME, { file_path: "src/a.ts" }),
      { type: "text", content: "再说一句", stage: "end" },
      tool(BASH_TOOL_NAME, { command: "ls" }),
    ];
    expect(segmentAssistantBlocks(blocks)).toEqual([
      { type: "single", index: 0 },
      { type: "activity", indexes: [1, 2, 3] },
      { type: "single", index: 4 },
      { type: "activity", indexes: [5] },
    ]);
  });
});

describe("summarizeActivity", () => {
  it("names the group from the first tool", () => {
    const blocks: MessageBlock[] = [
      tool(READ_TOOL_NAME, { file_path: "src/a.ts" }),
      tool(GREP_TOOL_NAME, { pattern: "foo" }),
      tool(BASH_TOOL_NAME, { command: "ls" }),
    ];
    expect(summarizeActivity(blocks, [0, 1, 2]).label).toBe(
      "检索 1 个文件，1 次搜索，运行了 1 条命令",
    );
    const editFirst: MessageBlock[] = [
      tool(EDIT_TOOL_NAME, {
        file_path: "a.ts",
        old_string: "a",
        new_string: "ab",
      }),
      tool(BASH_TOOL_NAME, { command: "ls" }),
    ];
    const summary = summarizeActivity(editFirst, [0, 1]);
    expect(summary.label).toBe("编辑 1 个文件，运行了 1 条命令");
    expect(summary.additions).toBeGreaterThan(0);
    expect(
      summarizeActivity(
        [tool(BASH_TOOL_NAME, { command: "ls" }), tool(READ_TOOL_NAME, { file_path: "a.ts" })],
        [0, 1],
      ).label,
    ).toBe("执行 1 条命令，查看了 1 个文件");
  });
});

describe("segmentAssistantTurn", () => {
  it("keeps the opening thought alone and joins tools across messages until text", () => {
    const messages = [
      {
        id: "a",
        blocks: [
          {
            type: "reasoning" as const,
            content: "先想",
            stage: "end" as const,
            startTime: 0,
            endTime: 8000,
          },
          tool(BASH_TOOL_NAME, { command: "ls" }),
        ],
      },
      {
        id: "b",
        blocks: [
          {
            type: "reasoning" as const,
            content: "再想",
            stage: "end" as const,
            startTime: 0,
            endTime: 1000,
          },
          tool(BASH_TOOL_NAME, { command: "pwd" }),
        ],
      },
      {
        id: "c",
        blocks: [
          { type: "text" as const, content: "做完了", stage: "end" as const },
          tool(GREP_TOOL_NAME, { pattern: "foo" }),
        ],
      },
    ];
    expect(segmentAssistantTurn(messages)).toEqual([
      { type: "single", ref: { messageIndex: 0, blockIndex: 0 } },
      {
        type: "activity",
        refs: [
          { messageIndex: 0, blockIndex: 1 },
          { messageIndex: 1, blockIndex: 0 },
          { messageIndex: 1, blockIndex: 1 },
        ],
      },
      { type: "single", ref: { messageIndex: 2, blockIndex: 0 } },
      {
        type: "activity",
        refs: [{ messageIndex: 2, blockIndex: 1 }],
      },
    ]);
    expect(
      summarizeActivity(messages[2].blocks, [1]).label,
    ).toBe("检索 1 次搜索");
  });
});

describe("tool lines", () => {
  it("labels a read slice and an edit, and only the edit expands", () => {
    const read = tool(READ_TOOL_NAME, {
      file_path: "src/styles/globals.css",
      offset: 1,
      limit: 120,
    });
    const edit = tool(WRITE_TOOL_NAME, {
      file_path: "preview/message-blocks.html",
      content: "a\nb",
    });
    expect(toolLineLabel(read)).toBe("读取 globals.css L1-120");
    const described = tool(BASH_TOOL_NAME, {
      command: "ls -la",
      description: "列出目录",
    });
    const bare = tool(BASH_TOOL_NAME, { command: "ls -la && echo ok" });
    expect(toolLineLabel(described)).toBe("运行 列出目录");
    expect(toolLineLabel(bare)).toBe("运行");
    expect(toolHasDetail(read)).toBe(false);
    const presented = toolPresentation(edit);
    expect(presented.label).toBe("编辑 message-blocks.html");
    expect(presented.additions).toBeGreaterThan(0);
    expect(toolHasDetail(edit)).toBe(true);
  });

  it("does not expand a failed edit", () => {
    const edit = tool(
      EDIT_TOOL_NAME,
      { file_path: "a.ts", old_string: "a", new_string: "b" },
      { success: false, error: "no" },
    );
    expect(toolHasDetail(edit)).toBe(false);
    expect(toolPresentation(edit).additions).toBe(0);
  });
});

describe("currentStatusLabel", () => {
  it("names the latest live step", () => {
    expect(currentStatusLabel([])).toBe("正在处理…");
    expect(
      currentStatusLabel([
        {
          role: "assistant",
          blocks: [tool(READ_TOOL_NAME, { file_path: "a.ts" }, { stage: "running" })],
        },
      ]),
    ).toBe("检索中…");
    expect(
      currentStatusLabel([
        {
          role: "assistant",
          blocks: [
            tool(
              EDIT_TOOL_NAME,
              { file_path: "a.ts", old_string: "a", new_string: "b" },
              { stage: "running" },
            ),
          ],
        },
      ]),
    ).toBe("编辑中…");
    expect(
      currentStatusLabel([
        {
          role: "assistant",
          blocks: [tool(BASH_TOOL_NAME, { command: "ls" }, { stage: "running" })],
        },
      ]),
    ).toBe("执行中…");
    expect(
      currentStatusLabel([
        {
          role: "assistant",
          blocks: [
            tool(BASH_TOOL_NAME, { command: "ls" }),
            { type: "reasoning", content: "想", stage: "streaming", startTime: 1 },
          ],
        },
      ]),
    ).toBe("思考中…");
    expect(
      currentStatusLabel([
        {
          role: "assistant",
          blocks: [{ type: "text", content: "好", stage: "streaming" }],
        },
      ]),
    ).toBeNull();
  });
});
