/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { AssistantSettings } from "../../src/components/settings/AssistantSettings";

vi.mock("../../src/components/settings/AssistantHandoffSettings", () => ({
  AssistantHandoffSettings: () => "handoff-panel",
}));
vi.mock("../../src/components/settings/MemoryDreamSettings", () => ({
  MemoryDreamSettings: () => "memory-panel",
}));
vi.mock("../../src/components/settings/AssistantLearningLibrary", () => ({
  AssistantLearningLibrary: () => "library-panel",
}));

describe("AssistantSettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a left nav with handoff, memory, and library sections", async () => {
    render(
      <Theme>
        <AssistantSettings />
      </Theme>,
    );

    expect(screen.getByText("handoff-panel")).toBeTruthy();
    const memory = screen.getByRole("button", { name: "记忆整理" });
    const library = screen.getByRole("button", { name: "知识库" });

    await userEvent.click(memory);
    expect(screen.getByText("memory-panel")).toBeTruthy();
    expect(memory).toHaveAttribute("aria-current", "page");

    await userEvent.click(library);
    expect(screen.getByText("library-panel")).toBeTruthy();
    expect(library).toHaveAttribute("aria-current", "page");
  });
});
