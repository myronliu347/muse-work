/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ChatHeader } from "../../src/components/chat/ChatHeader";

vi.mock("../../src/styles/ChatHeader.css", () => ({}));
vi.mock("../../src/styles/DesktopApp.css", () => ({}));

const baseProps = {
  onNewSession: () => {},
  onAbortMessage: () => {},
  messages: [],
  sessions: [],
  onSessionSelect: () => {},
  sessionsLoading: false,
  onOpenSettings: () => {},
  onLogin: () => {},
  onLogout: () => {},
  isAuthenticated: true,
  hideSessionButtons: true,
  hideMoreButton: true,
};

describe("ChatHeader gitContext", () => {
  it("shows a worktree metadata card on title hover with workdir", () => {
    render(
      <ChatHeader
        {...baseProps}
        gitContext={{
          branch: "worktree-a",
          worktreeName: "a",
          workdir: "/repo/.wave/worktrees/a",
        }}
      />,
    );
    const title = screen.getByText("新对话", { selector: ".header-title" });
    fireEvent.mouseEnter(title);
    const card = screen.getByTestId("desktop-worktree-card");
    expect(card.textContent).toContain("worktree-a");
    expect(card.textContent).toContain("a");
    expect(card.textContent).toContain("/repo/.wave/worktrees/a");
    expect(card.textContent).toContain("Worktree");
  });

  it("does not wrap the title in a worktree card without gitContext workdir", () => {
    render(
      <ChatHeader
        {...baseProps}
        gitContext={{ branch: "main", worktreeName: undefined, workdir: undefined }}
      />,
    );
    fireEvent.mouseEnter(screen.getByText("新对话", { selector: ".header-title" }));
    expect(screen.queryByTestId("desktop-worktree-card")).not.toBeInTheDocument();
  });
});
