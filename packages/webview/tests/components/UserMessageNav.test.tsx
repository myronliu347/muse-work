/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Message } from "@muse-work/agent";
import {
  UserMessageNav,
  navEntriesFromMessages,
  pickActiveUserMessageId,
} from "../../src/components/message/UserMessageNav";

afterEach(() => {
  cleanup();
});

function userMsg(id: string, text: string, extra?: Partial<Message>): Message {
  return {
    id,
    role: "user",
    timestamp: "0",
    blocks: [{ type: "text", content: text }],
    ...extra,
  };
}

describe("navEntriesFromMessages", () => {
  it("keeps user messages and skips meta / empty / assistant", () => {
    expect(
      navEntriesFromMessages([
        userMsg("u1", "mac 终端启动 iterm2"),
        { id: "a1", role: "assistant", timestamp: "0", blocks: [] },
        { ...userMsg("u-meta", "hidden"), isMeta: true },
        userMsg("u2", "  "),
        userMsg("u3", "open 命令系统内置么"),
      ]),
    ).toEqual([
      { id: "u1", text: "mac 终端启动 iterm2" },
      { id: "u3", text: "open 命令系统内置么" },
    ]);
  });
});

describe("pickActiveUserMessageId", () => {
  const items = [
    { id: "u1", top: 0 },
    { id: "u2", top: 400 },
    { id: "u3", top: 800 },
  ];

  it("keeps the user message at the top of the viewport active", () => {
    expect(
      pickActiveUserMessageId(items, { scrollTop: 0, clientHeight: 900 }),
    ).toBe("u1");
    expect(
      pickActiveUserMessageId(items, { scrollTop: 400, clientHeight: 500 }),
    ).toBe("u2");
    expect(
      pickActiveUserMessageId(items, { scrollTop: 800, clientHeight: 400 }),
    ).toBe("u3");
  });
});

describe("UserMessageNav", () => {
  const entries = [
    { id: "u1", text: "mac 终端启动 iterm2" },
    { id: "u2", text: "open ?" },
    {
      id: "u3",
      text: "能打开终端并且cd 到某个目录吗这是一段很长的用户消息",
    },
  ];

  it("renders a tick per user message and shows text for hover", () => {
    render(
      <UserMessageNav entries={entries} activeId="u3" onSelect={() => {}} />,
    );
    expect(screen.getByTestId("user-message-nav")).toBeInTheDocument();
    expect(screen.getByTestId("user-message-nav-u1")).toHaveTextContent(
      "mac 终端启动 iterm2",
    );
    expect(screen.getByTestId("user-message-nav-u3")).toHaveTextContent(
      "能打开终端并且cd 到某个目录吗这是一段很长的用户消息",
    );
  });

  it("exposes the full message as a tooltip and scrolls on click", () => {
    const onSelect = vi.fn();
    render(
      <UserMessageNav entries={entries} activeId="u3" onSelect={onSelect} />,
    );
    const long = screen.getByTestId("user-message-nav-u3");
    expect(long).toHaveAttribute(
      "title",
      "能打开终端并且cd 到某个目录吗这是一段很长的用户消息",
    );
    fireEvent.click(long);
    expect(onSelect).toHaveBeenCalledWith("u3");
  });

  it("marks the active entry", () => {
    render(
      <UserMessageNav entries={entries} activeId="u3" onSelect={() => {}} />,
    );
    expect(screen.getByTestId("user-message-nav-u3")).toHaveClass(
      "user-message-nav-item--active",
    );
    expect(screen.getByTestId("user-message-nav-u1")).not.toHaveClass(
      "user-message-nav-item--active",
    );
  });
});
