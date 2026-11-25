/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { AssistantLearningLibrary } from "../../src/components/settings/AssistantLearningLibrary";
import type { MuseApiClient } from "../../src/muse/apiClient";

function mockApi() {
  return {
    getMemoryDreamLearning: vi.fn().mockResolvedValue({
      workdir: "/Users/me/assistant-chat",
      memory: [
        { name: "MEMORY.md", content: "# Memory\n\n- [a](a.md) — a" },
        {
          name: "feedback_x.md",
          content:
            "---\nname: 反馈事项\ndescription: 一条反馈记忆\ntype: feedback\n---\n\n正文内容。",
        },
      ],
      rules: [],
      skills: [],
    }),
  } as unknown as MuseApiClient & {
    getMemoryDreamLearning: ReturnType<typeof vi.fn>;
  };
}

describe("AssistantLearningLibrary panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the library directly instead of a dialog trigger", async () => {
    render(
      <Theme>
        <AssistantLearningLibrary api={mockApi()} />
      </Theme>,
    );

    expect(await screen.findByText("当前助手知识库")).toBeTruthy();
    expect((await screen.findAllByText("反馈事项")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "查看知识库" })).toBeNull();
  });
});
