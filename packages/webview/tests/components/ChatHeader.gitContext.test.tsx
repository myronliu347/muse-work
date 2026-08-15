/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  it("renders DesktopGitContext inside the header when gitContext is set", () => {
    render(
      <ChatHeader
        {...baseProps}
        gitContext={{ branch: "feat/x", worktreeName: "x" }}
      />,
    );
    const header = screen.getByTestId("chat-header");
    expect(
      within(header).getByTestId("desktop-git-context"),
    ).toBeInTheDocument();
    expect(within(header).getByTestId("desktop-git-branch")).toHaveTextContent(
      "feat/x",
    );
    expect(
      within(header).getByTestId("desktop-git-worktree"),
    ).toHaveTextContent("x");
  });

  it("omits the badge when gitContext is absent", () => {
    render(<ChatHeader {...baseProps} />);
    expect(screen.queryByTestId("desktop-git-context")).not.toBeInTheDocument();
  });
});
