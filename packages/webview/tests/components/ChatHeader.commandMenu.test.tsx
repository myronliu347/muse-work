/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ChatHeader } from "../../src/components/chat/ChatHeader";
import { MuseTheme } from "../../src/ui/theme";

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

function renderHeader(props?: Partial<React.ComponentProps<typeof ChatHeader>>) {
  return render(
    <MuseTheme>
      <ChatHeader {...baseProps} {...props} />
    </MuseTheme>,
  );
}

describe("ChatHeader command menu", () => {
  it("renders the action button on the right of the header", () => {
    renderHeader({
      commandMenuItems: [
        { id: "compact", label: "压缩会话", icon: "codicon-fold", onClick: vi.fn() },
      ],
    });
    const header = screen.getByTestId("chat-header");
    const btn = screen.getByTestId("header-command-menu-btn");
    const buttons = header.querySelector(".header-buttons");
    expect(buttons).toContainElement(btn);
    expect(btn.querySelector(".codicon-ellipsis")).not.toBeNull();
  });

  it("does not render the button when no items are provided", () => {
    renderHeader();
    expect(
      screen.queryByTestId("header-command-menu-btn"),
    ).not.toBeInTheDocument();
  });

  it("opens the Radix menu and triggers the item action with an icon", async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn();
    renderHeader({
      commandMenuItems: [
        { id: "compact", label: "压缩会话", icon: "codicon-fold", onClick: onCompact },
        { id: "clear", label: "清空会话", icon: "codicon-trash", onClick: vi.fn() },
      ],
    });

    await user.click(screen.getByTestId("header-command-menu-btn"));
    const item = await screen.findByTestId("command-menu-compact");
    expect(screen.getByText("清空会话")).toBeInTheDocument();
    // 每个菜单项都有对应图标
    const icon = item.querySelector(".codicon-fold");
    expect(icon).not.toBeNull();

    await user.click(item);
    expect(onCompact).toHaveBeenCalledTimes(1);
    // 点击菜单项后菜单关闭
    expect(screen.queryByTestId("command-menu")).not.toBeInTheDocument();
  });
});
